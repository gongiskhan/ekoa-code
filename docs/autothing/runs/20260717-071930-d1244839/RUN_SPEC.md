# RUN_SPEC - Cortex Gateway, Claude Code v1 (run 20260717-071930-d1244839)

Authoritative brief: `BRIEF.md` (same dir). Its section 2 is DECIDED and not relitigated here.

## What / why

Harden the existing LLM gateway (`api/src/llm/gateway.ts`, mounted `/api/v1/llm`) so a STOCK Claude Code client pointed at it via `ANTHROPIC_BASE_URL` + a per-user gateway key works end-to-end, metered on the key owner's Ekoa billing. Four capabilities are missing today: (1) liveness for `stream:true` clients while the buffered upstream call runs (heartbeat-and-replay - the transport stays buffered, anonymisation outranks streaming); (2) model family mapping so stock `opus*/sonnet*/haiku*` ids land on EXPERT/WORKHORSE/FAST instead of the always-FAST clamp with thinking stripped; (3) `POST /v1/messages/count_tokens` forwarding (Claude Code calls it continuously; never billed); (4) per-user, revocable, hashed-at-rest gateway keys with per-key caps, billee = key owner, a settings surface, and Registo visibility.

## Acceptance criteria (run-level)

1. A stock `claude` CLI session against the local gateway (`ANTHROPIC_BASE_URL=<host>/api/v1/llm`, `ANTHROPIC_AUTH_TOKEN=<minted key>`) completes real multi-turn work; a slow turn shows `event: ping` frames on the wire (~15 s cadence) and the client survives without any timeout; the full detokenized SSE body then replays verbatim.
2. Auth failures and billing blocks keep clean HTTP statuses (401/402) - never SSE; only failures after the SSE commitment land in-stream as Anthropic-shaped `event: error` frames.
3. `claude-opus-*` / `*sonnet*` / `*haiku*` (dated suffixes, `[1m]`, case) resolve to EXPERT/WORKHORSE/FAST; exact tier-model match still wins first; `thinking`/`output_config` travel on any match and are stripped only on the unknown-model FAST clamp; metering bills the wire tier.
4. `POST /v1/messages/count_tokens` (and `/messages/count_tokens`) forwards through the chokepoint with full anonymisation posture and produces ZERO `token_events` rows.
5. Gateway keys: mint (shown once, never stored in plaintext, sha256 at rest), list (no secrets), revoke (owner-only, cross-user 404); key auth accepted on BOTH `Authorization: Bearer` and `x-api-key`; billee = owner with `agentType: 'gateway-client'`; revoked/inactive owner fails closed 401, billing-locked owner 402; per-key caps compose with user/org caps; mint/revoke + per-turn `gateway_turn` rows appear in Registo (metadata only).
6. `/settings/api-keys` page: mint with show-once panel + client-config snippet, list, revoke; PT/EN locales; no emoji; deterministic Playwright spec ledgered.
7. Every new endpoint has a `shared/` descriptor + contract test in the same slice; `schema-coverage` COVERED updated with `EXPECTED_PENDING_COUNT` unchanged (49).
8. Diagrams travel with each slice (06-llm-chokepoint-billing; 02-module-map + 12-org-tenancy for keys). Docs: api-contract.md new `## LLM gateway` section, security.md access-control subsection, decisions.md dated bullets.
9. Non-stream gateway path stays byte-identical (regression-pinned); bridge (`classify`, static key, JWT) behavior unchanged.
10. Full CI lane green: lint, chokepoint grep, typecheck, all tests, build, e2e ledger census, gitleaks/semgrep/audit.

## Non-goals (brief section 6)

Incremental token streaming; OpenAI-compat clients; exact-model passthrough; `ekoa-*` model-field substitution (S5 - see ledger A1); guided device-flow onboarding; anomaly detection beyond `lastUsedAt`; inference resale posture.

## Assumptions ledger (decisions made on the operator's behalf; chosen -> alternative)

- **A1 S5 pass-through.** The credential-mode owner check (brief section 5) is unresolved, so per the brief's own criterion the response `model` field passes through provider-verbatim in v1; the `ekoa-*` substitution lands together with the credential-mode decision (under buffered replay it is a string substitution on `message_start` before flush). Alternative: include it now - rejected because honesty and credential postures should land together.
- **A2 Firewall reading.** "Does not touch client.ts transport internals" = `defaultTransport` and the transport seam semantics. Tier resolution, `proxyGatewayMessages`, and a new `proxyGatewayCountTokens` are chokepoint glue the brief's own slices require touching (S2/S3/S4a). The one transport change is the brief-sanctioned count_tokens path selector. Alternative (zero client.ts diff) contradicts the brief's slices.
- **A3 Rate caps stay inside `proxyGatewayMessages`.** A cap trip after the SSE commitment is delivered as an in-stream `rate_limit_error` event (Claude Code backs off and retries, same UX as HTTP 429); refusal still happens before upstream spend and before metering. Alternative: a pre-check in gateway.ts - rejected (double read of the same sliding window, exports the cap key across the seam).
- **A4 count_tokens is uncapped, unbilled, allowance-exempt.** It shares the per-user call window that gates real messages; Claude Code polls it continuously, so capping it starves real turns. Free upstream, no usage. Residual: a keyed caller can hammer it (bounded upstream) - documented in security.md. Alternative: a separate cap bucket - deferred until abuse is observed.
- **A5 Key shape.** Secret `ekoa_gk_` + 32 bytes base64url; sha256 hex at rest with `_id = hash` (O(1) verify via `Store.get`, dup-safe, no index machinery; the hash is safe to expose as the public key id); `secretHint` = last 4 chars for the UI. Optional per-key `caps` override field honored by the limiter (brief: "keys carry per-key cap config"), not exposed in the v1 UI - env defaults `EKOA_RATECAP_CALLS_PER_KEY` / `EKOA_RATECAP_SPEND_PER_KEY` apply. Alternative: uuid `_id` + indexed keyHash field; bcrypt (wrong tool for 256-bit random secrets).
- **A6 Keys are self-service** for any ACTIVE user (`auth: 'user'`, no new capability): gateway use bills the caller exactly like chat; ownership scoping (owner stamped server-side; cross-user revoke = 404) is the authorization. Alternative: a `canManageGatewayKeys` capability / admin minting - deferred.
- **A7 Attribution.** New `UserWorkAgentType` member `'gateway-client'` (vocabulary addition, no ledger migration) so Claude Code usage is its own billing-breakdown line. `proxyGatewayMessages` gains optional `opts { agentType, keyId }`, defaults preserving `'pi-fast-loop'` for existing callers. Alternative: reuse `pi-fast-loop` - blurs the breakdown.
- **A8 Registo per-turn rows** (`gateway_turn`, metadata: keyId/tier/model/metered/correlationId) for USER-KEY principals only; JWT fast-loop + static-key subprocess traffic stays out (plumbing; the anon-audit already rows every request - volume precedent). Alternative: row every principal - noise.
- **A9 Heartbeat mechanics.** First ping immediately on SSE commitment, then every 15 s (`pingIntervalMs` injectable via `GatewayDeps` for tests - no fake-timer precedent in api tests); provider response headers are NOT forwarded in stream mode (headers are committed before the upstream result exists) - documented; client disconnect clears the timer but never aborts upstream (tokens were consumed; metering must land).
- **A10 authenticate() becomes async** (key verify hits the store), which mechanically adds `await` in `/models` + `/classify` handlers - read the firewall as "no BEHAVIORAL change to classify/bridge", not "no diff lines".
- **A11 /models honesty fix** rides S2: add the missing WORKHORSE row (today lists only FAST + EXPERT).
- **A12 Beta header pass-through is NOT built** unless the S6 live inventory shows a header-gated feature Claude Code needs that the body `betas` field cannot express (expected: none).
- **A13 S6 driver** is committed + ledgered but health-gated: SKIP (printed reason, exit 0) unless api up + real credential + `claude` CLI on PATH. Live-only evidence (ancillary-surface inventory, in-stream-error rendering by the real client) is recorded in api-contract.md/decisions.md, not asserted by CI.
