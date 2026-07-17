# Flow Plan - Cortex Gateway, Claude Code v1 (run 20260717-071930-d1244839)

Derived from `RUN_SPEC.md` (same dir); brief at `BRIEF.md`. Profile: **build** (6 slices). Every slice: contract tests in the same unit of work, diagram updates (FIXED-12), chokepoint grep stays green, non-stream/bridge paths regression-pinned.

## Slices

| # | Slice ID | Title | Kind | Routes to (area skill) | Parallel group | Status |
|---|----------|-------|------|------------------------|----------------|--------|
| 1 | S1 | Heartbeat-and-replay SSE liveness | api | ekoa-architecture | G1 | passed |
| 2 | S2 | Model family mapping (opus/sonnet/haiku -> tiers) | api | ekoa-architecture | G2 (after G1) | passed |
| 3 | S3 | count_tokens forwarding | api | ekoa-architecture | G3 (after G2) | passed |
| 4 | S4a | Per-user gateway keys (api: store, seam, caps, billing, Registo) | api | ekoa-architecture | G4 (after G3) | pending |
| 5 | S4b | Gateway keys settings UI (/settings/api-keys) | ui | ekoa-architecture | G5 (after G4) | pending |
| 6 | S6 | Live stock-Claude-Code proof driver + ancillary inventory | api | ekoa-testing | G5 (after G4) | pending |

S5 (model-field honesty) is NOT a slice: it ships as pass-through; its decision bullet rides S1 (ledger A1).

## Acceptance per slice

- **S1**: `stream:true` gets an immediate SSE 200 + `event: ping\ndata: {"type":"ping"}` frames (default 15 s, injectable `pingIntervalMs` in `GatewayDeps`), then the verbatim detokenized upstream SSE body raw-written and closed. Auth 401 / allowance 402 stay clean HTTP (pre-commitment). Post-commitment failures arrive as ONE Anthropic-shaped `event: error` frame (upstream non-2xx JSON wrapped; `CredentialError`->api_error text, `LlmRateCapError`->rate_limit_error). Client disconnect clears the timer, upstream still meters. Non-stream path byte-identical (test-pinned). Files: `api/src/llm/gateway.ts`, new `api/tests/llm/gateway-stream.test.ts`, diagram 06, api-contract.md `## LLM gateway` section, decisions.md (in-stream-429 + S5 pass-through bullets).
- **S2**: exported `matchFamilyTier` in `api/src/llm/client.ts` (opus->EXPERT, sonnet->WORKHORSE, haiku->FAST; case/dated/`[1m]`-tolerant substring); resolution = exact match -> family -> FAST clamp; strip condition moves to `resolvedTier === null` (params travel on family match); wire model = configured tier model. `/models` gains the WORKHORSE row. Tests: new `api/tests/llm/family-mapping.test.ts` unit matrix + gateway.test.ts integration (dated sonnet + thinking -> forwarded payload keeps thinking, metered WORKHORSE; alien model still clamps+strips). Diagram 06.
- **S3**: `POST /v1/messages/count_tokens` + `/messages/count_tokens`: `endpoint?: 'messages'|'count_tokens'` param on the transport's `messages()`; new `proxyGatewayCountTokens` (dedicated forward allowlist, full anonymisation posture incl. ephemeral-vault endSession, 401 refresh-retry, NO admitOrThrow, NO allowance, NO metering); shared descriptors `llmCountTokens`(+alias) with `LlmCountTokensResponse` in `shared/src/ekoa-local.ts`; schema-coverage COVERED (pending count stays 49). Tests: new `api/tests/llm/gateway-count-tokens.test.ts` (upstream URL, zero token_events, anonymisation applied, allowlist drops stream/max_tokens, clamp strips thinking, 401 retry). Diagram 06, api-contract.md.
- **S4a**: `GatewayKeyDoc` (`_id`=sha256(secret), ownerUserId/ownerUsername/orgId/label/secretHint/createdAt/revokedAt?/lastUsedAt?/caps?) + `gatewayKeys` store; `api/src/auth/gateway-keys-service.ts` (mint/list/revoke/verify + activation-cache admission + throttled lastUsedAt + logActivity mint/revoke); `verifyGatewayKey` seam injected via `GatewayDeps` (optional; llm/ never imports auth/); `authenticate()` async, accepts `ekoa_gk_*` on Bearer AND x-api-key, static key + JWT unchanged; billee=owner, `agentType:'gateway-client'` via new optional `proxyGatewayMessages` opts; per-key caps in `rate-caps.ts` (keyWindows + env defaults + doc override); billing-locked owner -> 402; `gateway_turn` Registo row per metered user-key turn; routes `api/src/routes/gateway-keys.ts` mounted `/api/v1/gateway-keys`; `shared/src/gateway-keys.ts` descriptors (mint/list/revoke) + index export + web domainMaps + COVERED. Tests: `api/tests/auth/gateway-keys-service.test.ts`, `api/tests/llm/gateway-keys-auth.test.ts`, rate-caps extension, `api/tests/contract/gateway-keys.test.ts` (lifecycle, no secrets in list, cross-user 404). Diagrams 06+02+12, security.md.
- **S4b**: `/settings/api-keys` page (devices-page pattern; PageShell/Card; show-once mint panel with copy + `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` snippet + "will not be shown again"; list with hint/created/last-used/revoked badge; inline revoke confirm); `web/stores/gateway-keys.ts` (users.ts pattern); nav entry; `pages_gatewayKeys` locale slice (pt/en/types, no emoji). New Playwright spec `web/e2e/gateway-keys.spec.ts` (mint shows once, gone after reload, revoke flips badge) + SUITE_LEDGER row. Walkthrough video + design audit apply (ui slice).
- **S6**: committed `api/tests/e2e/gateway-claude-code.e2e.mjs` (+ SUITE_LEDGER row), health-gated SKIP: mint key over HTTP; stock `claude` CLI with base URL + key reads a temp file whose path+content contain a ruleset-matched literal -> byte-identical round trip (non-empty ruleset) + empty-ruleset no-op repeat; multi-turn continue; direct `stream:true` slow probe asserts >=1 ping before replay; count_tokens probe; billing breakdown grows `gateway-client` rows on the owner. Live-only evidence recorded: ancillary endpoint inventory (api-contract appendix), Claude Code's rendering of an in-stream error, beta-header need check (A12). asciinema evidence.

## Parallelism

Serial chain S1 -> S2 -> S3 -> S4a (every api slice touches `gateway.ts` and/or `client.ts` - shared files, no fan-out). G5: S4b (web-only) and S6 (driver+docs) are disjoint -> build concurrently after S4a. Security-boundary slices (per-slice codex pass under build profile): all; S2's pass is folded into S3's scope per design.

## Global acceptance

RUN_SPEC acceptance 1-10. Tracked in `docs/autothing/runs/20260717-071930-d1244839/evidence-index.json -> globalGate`.
