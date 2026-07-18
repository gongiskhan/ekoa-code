VERDICT: approve

> **Status:** originally `needs-work` against `fc3afc2`. Finding 1 was accepted and fixed in `d9d0b3f`; I re-verified its closure with inverted probes against the fixed tree — see [`## Re-review`](#re-review) at the end of this file. The original review body below is preserved unedited as the record of what was found and how.

Fresh-context adversarial review of commit `fc3afc2` ("feat(gateway): S4a per-user gateway API keys - store, seam, caps, billing, Registo", 21 files) against the S4a acceptance criteria and the cited spec excerpts. One material finding survives verification; it is backed by a reproducible probe, not by inspection alone. The credential-custody core of the slice (secret handling, hash-at-rest, ownership authorization, auth ordering, billee attribution) is sound and I could not break it.

## Evidence

All commands run by me in this session against the post-change tree at `fc3afc2`.

### Gates (all green)

| Check | Result |
|---|---|
| `npm run typecheck` (shared + api + api tests + web) | exit 0 |
| `npx vitest run` × the 10 named suites | **10 files / 66 tests passed**, exit 0 |
| `npm run gate:chokepoint` | `clean (no @anthropic-ai/ or api.anthropic.com outside api/src/llm/)` |
| `npx eslint api/src/llm api/src/auth api/src/routes/gateway-keys.ts api/src/billing` | clean, no output |
| `grep -rnE "from '.*auth/\|require\(.*auth/" api/src/llm/` | **NONE — the `llm/` → `auth/` import ban holds.** Verification reaches the gateway only through the injected `GatewayDeps.verifyGatewayKey` seam, mirroring `verifyToken`; `server.ts` is the sole composition point. |

Files read in full post-change: `api/src/auth/gateway-keys-service.ts`, `api/src/llm/gateway.ts`, `api/src/billing/rate-caps.ts`, `api/src/routes/gateway-keys.ts`, plus `api/src/llm/client.ts` (cap/meter path), `api/src/auth/middleware.ts`, `api/src/data/activation.ts`, `api/src/data/activity.ts`, `api/src/data/store.ts`, `api/src/routes/registo.ts`, `api/src/routes/users.ts`, and all four new/changed test files.

### Rubric items verified CLEAN

**Secret handling.** The plaintext never leaves the mint response. `mintGatewayKey` computes `id = sha256(secret)` and persists `GatewayKeyDoc` with no secret field; the Registo row carries `{keyId, label}` only; `listGatewayKeys` projects a fixed field set (no secret exists to project); `verifyGatewayKey` logs nothing; the `gateway_turn` row carries `{keyId, tier, model, metered, correlationId, stream}` — metadata only. Pinned by `gateway-keys-service.test.ts` (`JSON.stringify(doc)).not.toContain(minted.key)`) and by the contract test (`JSON.stringify(list)).not.toContain(key)`).

**sha256-as-id is sound here.** The secret is 32 bytes from `randomBytes` (256 bits), so the "fast hash" objection to sha256 (offline brute-force of low-entropy input) does not apply — there is no search space to brute-force. `decisions.md` records the reasoning and the rejected alternatives (uuid+indexed-hash; bcrypt). `Store.insert` returns false on duplicate `_id` and the service throws, covering the 2^-256 collision.

**Timing.** No secret is ever string-compared on the key path: verification is `gatewayKeys.get(hashOf(secret))` — an O(1) preimage lookup, which is not timing-sensitive in the way a byte-wise compare is. (The static-key `apiKey === configuredKey` compare is a non-constant-time compare, but it is a pre-existing context line unchanged by this commit — see Observation 1.)

**Authorization.** The owner is stamped server-side from the verified JWT (`activityActorOf(req)` → `req.user.sub`); no route accepts an owner from the body — `GatewayKeyMintRequest` is `{label}` only. `listGatewayKeys(req.user!.sub)` is owner-scoped (stricter than org-scoped). `revokeGatewayKey` returns `false` for both a foreign owner and an unknown id, and the route maps both to the same `notFound(res)` — no cross-user existence oracle. Re-revoke is idempotent and writes exactly one Registo row. Pinned by the contract test's cross-user case (404 + valid `ErrorEnvelope`, B's list empty).

**Caller state on mint/list/revoke.** `r.use(requireAuth)` — the router inherits the full platform posture: JWT verify → jti-present → revocation → activation miss (401) → `active=false` (403 ACCOUNT_DISABLED) → token-epoch → `billingLocked` (402). Consistent with the platform middleware because it *is* the platform middleware. Contract test pins the unauthenticated 401 and the invalid-label 400 envelopes.

**Auth ordering / crafted credentials.** Order is static `===` → prefix-routed key verify → JWT. I probed the branch-confusion cases: a static key that itself starts with `ekoa_gk_` still wins on `x-api-key` (the `===` check precedes the prefix routing); presented on `Bearer` it fails both before and after this commit (previously `verifyToken` threw → null; now prefix-routes → `unknown` → null), so no regression. A JWT cannot start with `ekoa_gk_` (JWS compact serialization begins with base64url of `{"alg"…` → `eyJ`). Duplicate headers are joined by Node into one comma-separated string that fails the hash lookup. `revoked` and `unknown` both return `null` from `authenticate` and hit the identical `gatewayError(res, 401, 'Invalid or missing API key / JWT')` — no reason leak. Pinned by the auth test's `unknown -> 401; revoked -> 401` case.

**Billing integrity.** `billeeOf` returns `principal.userId` for `userkey`, which is `verdict.userId` = `doc.ownerUserId` — a key cannot bill anyone but its owner. `keyCaps` cannot be self-raised: `caps` is not settable through any route (mint accepts only `label`), so it is an operator/DB-side override. Even if raised, `check()` evaluates the user and org windows and returns *before* it reaches the key block, so user/org always bind. `recordSpend` accrues on the same `capKey` object `check()` used — `admitOrThrow` returns the merged key and the call site is `recordSpend({ ...capKey, metered })` (client.ts:1113 → :1243), so the keyId/keyCaps present at check time are present at record time.

**Tenant scoping.** The `gateway_turn` row is stamped `orgId: principal.orgId` ← `doc.orgId`, stamped at mint from the JWT. I checked for staleness: `UserPatch` is `{role?, active?}` only — `orgId` cannot change post-creation, so the key doc's org cannot drift from the user's. The Registo read surface (`routes/registo.ts`) is `requireAuth` + `requireRole('org-admin','super-admin')` and org-scoped through `readRegisto(actorOf(req), …)` — unchanged by this commit and consistent.

**Async `authenticate` — no TOCTOU, no unhandled rejection.** Express resolves to **5.2.1**, which forwards async-handler rejections to the error middleware (the Express 4 unhandled-rejection hazard does not apply), and `server.ts:742-743` additionally installs process-level `uncaughtException`/`unhandledRejection` log-and-continue. `/models` and `/classify` now `await` a previously-sync function, but their only new reject source is a store fault, which is handled by the above (see Observation 2 for the residual cosmetic issue). No TOCTOU: `verifyGatewayKey` re-reads the doc and re-consults the activation cache on **every** call, so revocation and deactivation are effective on the next request. The throttled `lastUsedAt` write cannot resurrect a revoked key — `Store.update` is a CAS read-modify-write that re-reads the current doc (`store.ts:50-61`) and the mutator spreads that fresh `cur`, not the stale captured `doc`; the fire-and-forget is correctly `void p.catch(() => {})`.

**Contract + registration.** `shared/src/gateway-keys.ts` descriptors registered in `ALL_ENDPOINTS` and re-exported from `index.ts`; `web/lib/api/index.ts` `domainMaps` includes `gatewayKeys`. All three ops added to `COVERED` in `schema-coverage.test.ts`; `EXPECTED_PENDING_COUNT = 49` **unchanged** (new endpoints that are immediately covered do not move the pending count). Contract test validates all three wire shapes against the shared zod schemas through a real `buildApp`, and both non-2xx bodies against `ErrorEnvelope`.

**Docs + diagrams.** `security.md` gains the keys subsection; `decisions.md` gains the rationale bullet. All three diagrams parse as valid JSON and pass the *enforced* invariant (`diagram-integrity.test.ts`: every text element carrying a `rawText` agrees with its `originalText` — 0 mismatches in 06/02/12), each carrying one S4a note. Note the acceptance phrasing "rawText==originalText==text" is stricter than what the repo enforces: the S4a notes in `02-module-map` and `12-org-tenancy` omit `rawText` entirely, which matches those files' own convention (02 has **no** text element with `rawText`). Not a defect.

### Probe that produced Finding 1

I wrote a throwaway probe (`api/tests/llm/zz-probe-classify-keycap.test.ts`, run then **deleted** — the tree is left clean) on the committed `gateway-keys-auth.test.ts` harness, with the seam returning `caps: { maxCallsPerWindow: 1 }` and a stub transport returning `'WORKHORSE'` so `/classify` takes the real metered `llm` path. All three cases passed, i.e. all three assertions about current behavior are confirmed:

```
✓ baseline: the key cap (1/window) DOES bind on /messages          (200, then 429)
✓ PROBE: N /classify calls through the SAME key each bill the owner but never accrue the key window
    PROBE: token_events billed to owner via /classify = 5
    PROBE: /messages status after 5 billed /classify calls on a 1-call-capped key = 200
✓ PROBE: an allowance-EXHAUSTED owner is still billed through /classify by the key
    PROBE: allowance-blocked owner — /classify status = 200 classifier = llm token_events billed = 1
```

Read the second block against the first: the same key that is refused on its **second** `/messages` call absorbs **five** metered `/classify` calls and then still gets a 200 on `/messages` — its window is empty. The third block: `/messages` correctly 402s the allowance-exhausted owner with nothing billed (the acceptance pin), and `/classify` then bills that same owner anyway.

## Findings

### 1. [Medium — material] ~~RESOLVED in `d9d0b3f`~~ Both admission controls the slice adds for key principals are absent on `/classify`, which the same key authenticates to and which meters spend against the owner

> **RESOLVED** — closure re-verified in [`## Re-review`](#re-review). Text preserved as found.

**Where:** `api/src/llm/gateway.ts` `router.post('/classify', …)` → `classifyViaModel(prompt, billeeOf(principal))` → `client.ts:937 completeFast` → `client.ts:940 admitOrThrow(billeeOf(attribution))` — called with **no** `keyScope` argument, unlike the `/messages` path at `client.ts:1113`.

**What the acceptance/spec say:**
- Acceptance: *"allowance gate applies to userkey principals (billee = owner)"* — stated unscoped. Probe case 3 shows a `userkey` principal billing an **allowance-exhausted** owner through `/classify` (1 `token_event` landed) on an account `/messages` correctly 402s with nothing billed.
- Acceptance: *"per-key rate-cap window in billing/rate-caps.ts … composing with user/org"* — probe case 2 shows five metered calls through a key capped at 1 call/window, after which `/messages` still returns 200 because `keyWindows` never saw them.
- Spec: *"A metered Anthropic-compatible endpoint is a token-farming target. Per-key caps plus the existing pre-admission user caps are the v1 answer."* On `/classify` only half that answer is deployed.

**Why this is a gap and not a scope boundary.** The slice already treats `/classify` as key-reachable — the acceptance's own billing-locked matrix names it (*"billing-locked owner -> 402 BILLING_LOCKED on messages/count_tokens/models/classify"*), and that control **is** correctly wired there. So `/classify` got one of the three key-principal controls and not the other two. This is an internal inconsistency in the surface the slice itself defined, not an endpoint it declined to cover. The deliberate S3 carve-out does **not** cover it either: that carve-out is justified in-code by count_tokens being *"free upstream, no usage"* and unmetered — `/classify` meters real spend against the owner (`kind: 'classifier'` bills `billeeUserId`, `attribution.ts:50,116-121`).

**Impact.** A leaked or abused key burns the owner at the per-**user** ceiling (`EKOA_RATECAP_CALLS_PER_USER=60`/min, `SPEND_PER_USER=5M`/window) rather than its own per-**key** ceiling (30/min, 2M) — the headline control of the slice is bypassable by choosing a different path on the same router — and can bill an owner whose allowance is exhausted. The `prompt` is fully attacker-controlled and `/classify` is mounted behind the same `largeJson` 50 MB parser, so per-call input-token spend is not small even with `maxTokens: 8`. **Bounded by:** user/org windows still bind, the billing-lock 402 still fires, revocation still works on the next call, and `/classify` is not a surface a stock Anthropic client calls — this is a cap-weakening, not an unbounded-spend hole. Hence Medium, not High.

**Suggested fix.** Thread the key scope through the `/classify` path so the key window composes there as it does on `/messages` — either extend `completeFast` with the same optional `{keyId, keyCaps}` scope that `proxyGatewayMessages` gained and pass it from the handler when `principal.kind === 'userkey'`, or gate the handler directly (`checkAllowance` + a key-scoped `checkRateCaps`) for `userkey` principals before `classifyViaModel`. Prefer the former for symmetry with the seam already added. Whichever is chosen, a regression pin mirroring the committed *"per-key caps compose"* case — but exercising `/classify` — should land with it. If the team instead judges `/classify` intentionally out of scope for key caps, that needs to be an explicit written carve-out (the count_tokens comment is the model to follow), because the current code reads as an oversight rather than a decision.

## Observations (non-blocking, not counted against the verdict)

1. **Non-constant-time static-key compare.** `gateway.ts` `apiKey === configuredKey` compares a secret with `===`. **Pre-existing and unchanged by this commit** (it appears as a context line in the diff), and the new key path deliberately avoids the pattern. Out of scope for S4a; noting for the findings ledger.
2. **Error-shape drift on a store fault in the key path.** `authenticate` can now reject (via `gatewayKeys.get`). Express 5 + the process-level handler mean no crash and no hang, but the gateway's own error middleware only shapes body-parser errors and `next(err)`s the rest — so a Mongo blip on a key-authenticated request answers in the CONV-2 envelope rather than the provider `{type:'error'}` shape that stock clients parse. The same shape already applies to the pre-existing `checkAllowance` reject path. Cosmetic.
3. **`lastUsedWrites` is never pruned.** Unbounded in principle, but only populated *after* a successful doc lookup, so it is not attacker-growable — it is bounded by the number of distinct valid keys used per process lifetime. Negligible.
4. **No cap on keys minted per user.** The spec explicitly scopes v1 to *"the smallest schema that supports revocation and per-key caps"*, each key is independently capped, and the user window still binds, so there is no billing amplification. Noting only.
5. **Minor:** `verifyGatewayKey`'s throttle uses `Date.now()` directly while `mint`/`revoke` take an injected `deps.now()`. Harmless (the committed test drives it with real sleeps) but inconsistent with the module's own clock-injection convention.

## Re-review

Re-review of `d9d0b3f` ("fix(s4a-review): classify admission for key principals + honest secretHint claims", 6 files) against Finding 1. **Finding 1 is genuinely closed.** Verdict flipped to `approve`.

### Closure evidence — my original probes, re-pointed with INVERTED expectations

I did not re-run the implementer's tests and call it closed. I re-ran **my own** probes 2 and 3 against the fixed tree with every assertion negated, so a pass means the behavior actually flipped rather than being re-described, and added a third case checking the fix did not over-block. All three passed (probe file run then deleted; tree left clean):

```
✓ PROBE 2 (was: 5 billed, key window empty) -> the key window NOW accrues on /classify
    RE-PROBE 2: classifier labels = ["llm","keyword-fallback","keyword-fallback","keyword-fallback","keyword-fallback"] | token_events billed = 1
    RE-PROBE 2: /messages status after the classify calls = 429
✓ PROBE 3 (was: blocked owner billed via /classify) -> allowance gate now applies, ZERO billed
    RE-PROBE 3: blocked owner — /classify status = 200 classifier = keyword-fallback tier = FAST | token_events billed = 0
✓ REGRESSION: a JWT principal and an UNCAPPED key still reach the llm path (fix did not over-block)
    RE-PROBE regression: JWT classify classifier = llm
```

Read against the original numbers, every one inverted:

| Probe | Pre-fix (`fc3afc2`) | Post-fix (`d9d0b3f`) |
|---|---|---|
| 5 × `/classify` on a key capped at 1/window | **5** metered, all `classifier: 'llm'` | **1** metered; calls 2-5 degrade to `keyword-fallback` |
| `/messages` after those calls | **200** (key window empty) | **429** (key window holds the classify spend) |
| `/classify` for an allowance-exhausted owner | **1** metered, `classifier: 'llm'` | **0** metered, `classifier: 'keyword-fallback'` |
| `/classify` for a JWT principal | `llm` | `llm` (unchanged — no over-block) |

### Gates re-run on the fixed tree

| Check | Result |
|---|---|
| `npx vitest run` × the 10 named suites | **10 files / 68 tests passed** (was 66 — the two new pins) |
| `npm run typecheck` | exit 0 |
| `npm run gate:chokepoint` | clean |
| `npx eslint api/src/llm api/src/auth api/src/routes/gateway-keys.ts api/src/billing` | clean |
| `grep -rnE "from '.*auth/" api/src/llm/` | NONE — seam boundary still holds |

### Fix shape assessed

Correct and minimal. `completeFast` gains an optional third `capScope` param threaded into the existing `admitOrThrow(billee, keyScope)` — so the key window composes at the *same* chokepoint gate `/messages` uses, and because `admitOrThrow` returns the merged key, `recordSpend({ ...capKey, metered })` accrues it on the identical `capKey`. That is what makes probe 2 flip, and it is the reason the fix is structural rather than a second parallel check that could drift. Existing callers pass `undefined` and resolve to the pre-fix expression exactly (`{ ...capKeyFor(billee), ...({}) }`), which the untouched 66 tests confirm. A cap trip throws `LlmRateCapError` *inside* `completeFast`, caught by the handler's pre-existing `catch` → keyword fallback: no new failure mode. The allowance gate sits in the handler and degrades to the free deterministic path rather than 402ing — the right call for this endpoint specifically, since the invariant my finding cited ("a blocked owner is never billed") holds while the client still gets a usable routing answer and the never-500s contract is preserved. The `mode === 'keyword' ? 'keyword' : 'keyword-fallback'` label keeps the existing `gateway.test.ts` keyword-mode pin honest and reports the degradation truthfully. The two committed pins mirror my probe cases faithfully.

### Attribution kind — explicitly NOT a violation (asked directly)

The team asked whether `/classify` keeping `{ kind: 'classifier', agentType: 'classify-tui-turn', billeeUserId: owner }` is itself a violation. **It is not, and changing it would be wrong.**
- `attribution.ts:50` states the rule: *"`classifier` bills the requesting user at FAST weight."* For a key principal the requesting user **is** the key owner, which is exactly what is passed. The spec is satisfied as written.
- The acceptance's `'gateway-client'` requirement is scoped by its own wording to the messages path — *"`proxyGatewayMessages` gains optional opts {agentType, keyId, keyCaps}… billee=owner metered with agentType 'gateway-client'"*. It says nothing about the classifier site.
- Re-labelling would actively damage two things: it would break §6.4.2's six-classifier-site accounting, and it would make routing classifications indistinguishable from real gateway turns in the billing breakdown that `'gateway-client'` exists to isolate.

My finding asked for **admission parity** (allowance + per-key window), never attribution re-labelling. Admission parity is now enforced; the attribution is correct as-is.

### secretHint disposition — agreed

I did not raise this one, and for the record I independently reached the same conclusion in my first pass (see Evidence → "Secret handling"/"sha256-as-id is sound here"): a 4-char tail of a 256-bit secret is immaterial. The right fix was the one taken — the *claim* was wrong, not the code, and the docstring plus `security.md` now state the trade instead of overclaiming "sha256 only at rest". No disagreement. One no-action nit: the docs say "24 of 256 entropy bits"; the true figure is 22 (base64url of 32 bytes is 43 chars, and the final char carries only 4 bits, so the tail leaks 6+6+6+4). The docs overstate the cost, which errs in the safe direction — not worth a commit.

### Observations carried forward (non-blocking)

Observations 1-5 from the original review stand unchanged. One addition, of the same non-blocking class:

6. **`/classify`'s never-500s contract now has a second unguarded await.** `checkAllowance(principal.userId)` sits outside the handler's `try`, and `allowance.ts:38-60` does unguarded store I/O (`ensureAccount`, `billingAccounts.update`, `readGlobalOverageEnabled`), so a store fault rejects the handler → Express 5 error middleware → 500, against the handler's own docstring (*"This endpoint NEVER 500s — any failure degrades to the keyword decision (§6.4.2 site 19)"*) and the fix commit's claim that the contract is kept. **Inspection-only, Low, explicitly not a blocker** — it is the same shape as Observation 2 (S4a's `await authenticate`), which I already judged cosmetic, and consistency demands the same treatment; it needs an infrastructure fault to trigger and costs a graceful degrade, not a security property. If someone wants it airtight, it is one line: wrap the call in `try { … } catch { admitLlm = false }`, which fails closed to the free keyword path and matches the endpoint's whole degradation philosophy. Worth a findings-ledger entry rather than a fix round.
