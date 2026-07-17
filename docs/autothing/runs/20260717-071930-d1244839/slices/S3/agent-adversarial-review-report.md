VERDICT: approve

Fresh-context adversarial review of commit `4813886` ("feat(gateway): S3 count_tokens forwarding + live 50MB gateway body limit") against the S3 slice acceptance (a)-(e), the spec excerpts, and the security-boundary rubric. Reviewer had no access to the implementer's session. All evidence below was gathered independently by this reviewer (commands re-run, not trusted from a report), including eleven throwaway adversarial probes written for this review and deleted afterwards.

No material finding survived. Three low-severity, non-blocking findings are recorded for the ledger.

## Evidence

### Commands run by this reviewer

| Command | Result |
|---|---|
| `npm run typecheck` | **exit 0** |
| `npx vitest run tests/llm/gateway-count-tokens.test.ts tests/llm/gateway-body-limit.test.ts tests/contract/llm-count-tokens.test.ts tests/contract/schema-coverage.test.ts tests/contract/mount-coverage.test.ts tests/contract/malformed-json.test.ts tests/llm/gateway.test.ts tests/llm/anonymise-chokepoint.test.ts` | **exit 0** — 8 files / 40 tests passed |
| `npm run gate:chokepoint` | **clean** (no `@anthropic-ai/` or `api.anthropic.com` outside `api/src/llm/`) |
| `npx vitest run tests/docs/diagram-integrity.test.ts` | **exit 0** — 13 tests passed |
| `npm run lint` | **0 errors**, 217 pre-existing warnings (no new errors) |

### Independent probes (throwaway suite, written by this reviewer, run against real `buildApp`, then deleted)

```
P1  /api/v1/llmfoo 2MB                -> 404 {"error":{"code":"NOT_FOUND",...}}                (CONV-2 envelope)
P2  CASE-VARIANT /API/v1/llm/... 2MB  -> 413 {"error":{"code":"PAYLOAD_TOO_LARGE",...}}        (CONV-2 envelope)
P3  gateway body >50MB                -> 413 {"type":"error","error":{"type":"invalid_request_error","message":"Request body too large"}}
P4  non-gateway malformed JSON        -> 400 {"error":{"code":"VALIDATION_FAILED",...}}        (CONV-2 envelope)
P5  `endpoint` in count_tokens BODY   -> transport endpoint = count_tokens | payload has endpoint key? false
P6  `endpoint` in messages BODY       -> transport endpoint = undefined
P7  vault count after ephemeral count_tokens = 0
P8  vault count after 5 client-chosen metadata.session_id values on the UNCAPPED path = 5
P9  CASE-VARIANT small body           -> 200 | transport called? true   (the case-variant IS a live gateway route)
P10 lowercase control                 -> 200 | transport called? true
P11 text/plain content-type to count_tokens -> 200, payload = {"model":"claude-haiku-4-5-20251001"} (no crash)
```

### Acceptance verification

**(a) count_tokens forwarding.** Both paths registered (`gateway.ts:266-267`) on the shared `authenticate()` used by `/messages` — injected JWT verifier or static `x-api-key`, clean 401 in the gateway error shape (`authentication_error`), pinned by the committed test. Anonymisation posture traced end to end in `proxyGatewayCountTokens` (`client.ts:1266-1330`): `anonymizeRequestBody(reqBody, anonCtx)` runs BEFORE the transport, the forward allowlist iterates `anon.body` (**not** `reqBody` — verified line 1293), `deanonymize(resp.body, anon.handle)` runs after, and `endSession(anon.handle)` sits in a `finally` guarded by `!hasSession`. P7 independently confirms `__vaultCount() === 0` after an ephemeral call; the committed test confirms a deny-listed literal never reaches the transport. S2 tier resolution is the same exact -> family -> FAST-clamp chain as `proxyGatewayMessages` (`matchConfiguredTier` -> `matchFamilyTier` -> `'FAST'`), clamp strips `thinking`/`output_config`, wire model is `decision.model.replace(/\[1m\]$/, '')`. oauth 401 refresh-and-retry-once present. Dedicated allowlist `COUNT_TOKENS_FORWARD_FIELDS` (`client.ts:1236-1239`) carries exactly the nine specified fields; `stream`/`max_tokens`/`metadata`/sampling params are dropped (committed test asserts each). Transport selector is `endpoint?: 'messages' | 'count_tokens'` (optional -> every existing full-object fake stays compilable, proven by repo-wide `typecheck` exit 0); URL suffix built at `client.ts:467-468`.

**Refresh-retry vault question (rubric).** `payload` is computed ONCE at `client.ts:1315-1318`, before the `try`. Both `transport.messages(...)` calls (lines 1322 and 1324) pass that same object, and the single `deanonymize` uses the single `anon.handle`. The retry re-sends the **same tokenized body against the same session vault** — no re-tokenization, no second vault. Correct.

**(b) Never billed / never capped / allowance-exempt.** No `meter()`, no `recordSpend()`, no `admitOrThrow()`, no `checkAllowance()` on the path — `GatewayCountTokensResult` has no `unmetered`/`metered` fields, so `gatewayUnmeteredCalls` cannot move either. The committed test proves the composite: with `EKOA_RATECAP_CALLS_PER_USER=0` and a billing-blocked owner, count_tokens returns 200 while the sibling real message from the same user returns 402, and `tokenEvents` stays empty.

**(c) Body-limit fix.** `server.ts:530-532` skips the global 1 MB parser for `/api/v1/llm`; the gateway's own `largeJson` (50 MB) is now the live parser. Gateway parse failures answer Anthropic-shaped: P3 independently confirms the 413 branch (`entity.too.large` -> `invalid_request_error`), the committed test confirms the 400 branch. Non-gateway routes keep 1 MB + CONV-2: P4 (malformed -> `VALIDATION_FAILED`) and the committed 2 MB pin (`PAYLOAD_TOO_LARGE`).

**(d) Contract.** `LlmCountTokensResponse` + `llmCountTokens`/`llmCountTokensAlias` descriptors in `shared/src/ekoa-local.ts`; both added to `COVERED`; `EXPECTED_PENDING_COUNT` still literally `49` (`schema-coverage.test.ts:113`, unchanged by the diff). `llm-count-tokens.test.ts` drives the **real** `buildApp` over both mounted paths and validates the 2xx against the shared zod schema. `schema-coverage` and `mount-coverage` both pass.

**(e) Docs.** `api-contract.md` carries both paragraphs (count_tokens + body limits/parse errors, the latter explicitly naming itself the one declared CONV-2 exception, scoped to the Anthropic wire surface). `security.md` carries the uncapped residual. `decisions.md` carries two dated 2026-07-17 bullets. Diagram 06 carries `s3-count-tokens-note`: file parses, and `rawText == originalText == text` for that element (verified directly); the diagram-integrity suite passes.

**Firewall.** `client.ts` changes are confined to the `endpoint?` field on `RestCallParams`, the two-line suffix in `defaultTransport.messages`, and the new count_tokens block appended at the end. `proxyGatewayMessages` is untouched. `server.ts` change is the 9-line parser skip. Within sanction.

### Security-boundary rubric

- **Can count_tokens smuggle a real completion?** **No.** `endpoint: 'count_tokens'` is a hardcoded literal on both transport calls in `proxyGatewayCountTokens`, sits on `RestCallParams` as a *sibling* of `payload` (never spread from the request body), and is absent from both forward allowlists. P5: an `endpoint` field in the count_tokens body neither changes the wire suffix nor survives into the payload. P6: an `endpoint` field in the messages body leaves the selector `undefined` (i.e. `/v1/messages`). The selector is not attacker-controllable in either direction.
- **Does the uncapped endpoint leak what the capped one protects?** **No.** The response is the provider's verbatim `{input_tokens}` body. No billing state (the 402 allowance body with `billingUrl` is never emitted here), no org data, no allowance verdict. The only org-derived input is `resolveRuleset(orgId)`, which shapes tokenization but is never echoed. Response headers are filtered identically to the messages path. (A theoretical `input_tokens` side-channel on the org deny-list exists, but the messages path already echoes vault tokens directly — a strictly stronger oracle — so count_tokens adds nothing qualitative.)
- **Does the parser-skip widen parsing for a NON-gateway path?** **No.** Express's `app.use('/api/v1/llm', ...)` prefix match requires `/` or end-of-string, so `/api/v1/llmfoo` is not a gateway route; the predicate over-matches it, but it lands on the `/api/v1` catch-all 404, which reads no body (P1 -> 404 CONV-2). Traversal-ish prefixes fall into the gateway mount and fail to match any gateway route, ending at the same 404. No non-gateway route gains a widened limit. (Case variants go the other way — see F1.)
- **Does the gateway error handler swallow other routers' errors?** **No.** It is a `router.use` error handler scoped to the `/api/v1/llm` mount, so it can only observe errors raised inside that router. Confirmed empirically: P1 and P4 both still answer in the CONV-2 envelope.
- **Is anonymisation genuinely applied?** **Yes** — traced above; independently confirmed by P7 and by the committed deny-list test.

## Findings

### F1 — LOW / non-blocking: the parser-skip predicate is case-sensitive, the router mount is not

`api/src/server.ts:531-532` gates on `req.path.startsWith('/api/v1/llm')` (case-sensitive), but Express routing defaults to `case sensitive routing: false`, so `app.use('/api/v1/llm', gatewayRouter(deps))` also matches case variants. The two matchers therefore disagree about what "/api/v1/llm" means.

Evidence (both probes, this reviewer):
- **P9**: `POST /API/v1/llm/v1/messages` with a small body -> **200, transport called** — the case-variant IS a live gateway route.
- **P2**: the same path with a 2 MB body -> **413 `{"error":{"code":"PAYLOAD_TOO_LARGE"}}`** — the global 1 MB parser ate it and answered in the **CONV-2 envelope**, on the Anthropic wire surface.

So on a case-variant base URL, the exact defect S3 exists to fix (acceptance (c): "server.ts's global 1mb json parser must NOT pre-parse /api/v1/llm") is still present, and CONV-2 leaks onto a surface the same acceptance says must never carry it.

Not material, hence non-blocking: reachable only via a mis-cased `ANTHROPIC_BASE_URL` (an operator misconfiguration no stock client produces), it fails loudly rather than silently, and it is strictly *more* restrictive — no security consequence. Fix if touched: `req.path.toLowerCase().startsWith('/api/v1/llm')`, or set `case sensitive routing` on the app so the two matchers agree.

### F2 — LOW / non-blocking: two acceptance clauses have no committed pin

Both behaviors are **correct** — this reviewer verified each by hand — but neither is regression-pinned, so nothing stops a future change from silently reverting them:

1. Acceptance (c)'s **413 too-large** branch of the gateway error handler (`gateway.ts:340-343`). `gateway-body-limit.test.ts` covers 2 MB -> 200, malformed -> 400, and the CONV-2 pin, but never exercises `entity.too.large`. Verified manually — **P3**: a >50 MB gateway body -> `413 {"type":"error","error":{"type":"invalid_request_error","message":"Request body too large"}}`.
2. Acceptance (a)'s **"ephemeral vault cleared in a finally"** clause. `gateway-count-tokens.test.ts` asserts anonymisation applies (deny-listed literal never reaches the transport) but never asserts the vault is cleared. Verified manually — **P7**: `__vaultCount() === 0` after an ephemeral count_tokens call.

Both are cheap to pin (`__vaultCount()` is already exported for exactly this).

### F3 — NIT: `(fast-clamp)` drops are logged as "unexpected"

`api/src/llm/client.ts:1300` pushes `` `${key} (fast-clamp)` `` into `droppedFields`, and line 1308 filters with `COUNT_TOKENS_ROUTINE_DROPS.has(k)` — which contains bare keys only. So `'thinking (fast-clamp)'` never matches, and an unknown-model count_tokens call carrying `thinking` logs `[llm] gateway count_tokens: dropped unexpected top-level fields: thinking (fast-clamp)`. The fast-clamp drop is routine and expected on every unknown model (the committed "unknown model: FAST clamp strips thinking" test walks exactly this path), so the line contradicts its own stated intent — the comment at `client.ts:1241-1243` says these routine drops are excluded "same honesty rule as the metadata session_id exclusion above". Cosmetic log noise on an endpoint Claude Code polls continuously; no behavioral impact.

### Residual noted (documented, not a finding)

**P8**: five distinct client-chosen `metadata.session_id` values on the uncapped path leave five live vaults (`hasSession` -> no `endSession`; swept only at the 30-minute TTL). Because `admitOrThrow` is deliberately skipped, an authenticated caller can allocate server-side vault state without a call cap — a mild amplification of the same unbounded-`session_id` behavior the (capped) messages path already has. Each entry is tiny and TTL-swept, and acceptance (b) *mandates* the uncapped design, so this is not a defect against the slice. `docs/security.md` and `decisions.md` do disclose the abuse residual, though both frame the bound as "upstream provider limits on the central credential" and do not mention local vault allocation. Worth a clause if the residual is revisited.
