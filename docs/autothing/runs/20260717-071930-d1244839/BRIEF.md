# Cortex Gateway — Claude Code v1

**Status:** Supersedes the parked `cortex-gateway-brief.md` (2026-07-07) in full. That brief assumed the adapter had to be built; exploration of `ekoa-code` (2026-07-17) found the gateway already exists — this brief re-scopes the work as hardening, not construction. Runs as its own post-rc module run. Does not enter the current hardening run; Phase 3 (full end-to-end build journey) remains the terminal proof gate of that run.

**Scope:** Stock Claude Code pointed at Cortex via `ANTHROPIC_BASE_URL`, metered against the user's Ekoa billing. Nothing else. OpenAI-compat clients (Codex, OpenCode, Pi) are a later phase and out of scope here.

---

## 1. What already exists (grounding, verified in repo)

`api/src/llm/gateway.ts`, mounted at `/api/v1/llm` by the composition root:

- `POST /messages` and `POST /v1/messages` — Anthropic Messages-compatible, so `ANTHROPIC_BASE_URL=https://<cortex-host>/api/v1/llm` resolves correctly for a stock client.
- Auth: injected `verifyToken` (JWT) or the single static platform key (`llm/` may not import `auth/`; the seam is injected by `server.ts` — any new auth mechanism follows the same pattern).
- Billing: `checkAllowance` gate (402 with `billingUrl`), metering inside the chokepoint via `proxyGatewayMessages`, pre-admission rate caps (`admitOrThrow`), `gateway_unmetered_call` counter on `/health`.
- Anonymisation pipeline on the path: request tokenized before transport, response detokenized on the complete body, vault keyed by session id, correlation id joins hosted audit with the caller's ledger.
- Tier resolution: exact match against the three configured tier models runs at that tier; any other model string clamps to FAST and strips model-tuned reasoning params.
- Forward allowlist (`GATEWAY_FORWARD_FIELDS`) already covers everything Claude Code sends: `tools`, `tool_choice`, `system`, `thinking`, `output_config`, `betas`, `mcp_servers`, `cache_control`, `metadata` (allowlisted to `user_id` on the wire).
- Empty-text-block scrub, OAuth 401 refresh-and-retry, provider error classing onto `/health`.
- `GET /models` (Anthropic-style envelope), `POST /classify` (bridge-only, untouched by this run).
- `auth/device.ts`: RFC-8628-style device flow — not required for v1, available for guided onboarding later.

The transport buffers responses (`await res.text()`), including SSE bodies. **This stays.** Streaming pass-through was evaluated and rejected for v1: it would force incremental detokenization across chunk boundaries, weakening the anonymisation layer. Anonymisation outranks streaming.

## 2. Decided (not up for relitigating in planning)

1. **No incremental streaming in v1.** The upstream call stays buffered exactly as today; detokenization keeps operating on the complete body.
2. **Heartbeat-and-replay for liveness.** When the client sends `stream: true`: open the SSE response immediately, emit protocol-legal `ping` events (`event: ping` / `data: {"type":"ping"}`) on an interval (~15 s, comfortably under common 60 s idle timeouts) while the buffered upstream call runs, then flush the full detokenized SSE body and close. Claude Code's parser ignores pings natively; its spinner keeps counting; no proxy or client timeout fires.
3. **Never inject status text into message content.** No "this may take a while" strings in the response body — anything there enters the transcript, is re-read every turn, and pollutes context and caching. Liveness is carried entirely by SSE framing.
4. **Keep `stream: true` upstream.** Do not convert to a non-streamed provider call: the provider hard-rejects non-streaming requests with large `max_tokens`, and Claude Code always sends large `max_tokens`. Buffer the streamed SSE text as the transport already does.
5. **Model family mapping.** `opus*` → EXPERT, `sonnet*` → WORKHORSE, `haiku*` → FAST, matched on the model-id family, tolerant of dated suffixes and the `[1m]` marker. Exact match against a configured tier model still wins first. Unknown strings keep the historical FAST clamp. Reasoning params (`thinking`, `output_config`) travel on any family match; stripped only on the clamp. Without this, every stock Claude Code session exact-misses, runs on the FAST model with thinking stripped, and the user concludes the product is bad.
6. **`POST /v1/messages/count_tokens`.** Claude Code calls it continuously for context management. Forward through the chokepoint (same credential injection, same anonymisation posture as messages). Never billed — it is free upstream in api-key mode and produces no usage. Absence of this endpoint degrades Claude Code's context handling silently.
7. **Per-user gateway keys.** Long-lived, revocable, one or more per user, shown once at mint, hashed at rest, per-key rate caps, billee = key owner. The static platform key and JWT paths remain for the bridge. Claude Code setup becomes: base URL + `ANTHROPIC_AUTH_TOKEN=<key>`.
8. **Firewall.** This run touches `api/src/llm/gateway.ts`, the key store + settings surface, `shared/` contracts for new endpoints, and tests/diagrams. It does not touch `client.ts` transport internals beyond what count_tokens forwarding requires, does not touch the bridge, does not touch `classify`.

## 3. Suggestive — load these into the planning session as decision criteria

**Heartbeat commitment point.** Once the first ping is written, the 200 status and SSE framing are committed. A subsequent upstream failure (401, 429, 402-would-have-been, 5xx) must be delivered as an SSE `error` event in the provider's error shape, not a status change. Criterion: run the allowance gate and authentication *before* opening the SSE response, so billing blocks and auth failures keep their clean HTTP statuses; only provider-side failures land in-stream. Verify Claude Code's rendering of an in-stream error event with a live client before locking the shape.

**Where the heartbeat lives.** Contained in `gateway.ts`'s request handler. The transport and `proxyGatewayMessages` should not know about it. Criterion: if the implementation wants to modify the transport signature for this, the design is wrong.

**Buffered-replay flush.** The buffered body is the provider's verbatim SSE text (post-detokenization). Replaying it after pings should be a raw write of that text — do not re-parse and re-serialize events. Exception: if the model-field decision below lands in v1, the single `message_start` event is the one place light rewriting happens.

**Model-field honesty (decision, cheap now).** The July brief locked `ekoa-*` in the response `model` field as the ToS-clean, machine-readable posture. Under buffered replay this collapsed from "SSE parser work" to a string substitution in the buffered body before flush. Criterion for including it in v1: if the credential-mode owner check (§5) resolves to api-key mode before this run starts, include it; if the mode question is still open, ship v1 as pass-through and log the decision, because the honesty posture and the credential posture should land together.

**Anonymisation × tool round-trips — a test case, not an assumption.** A tokenized path or identifier that reaches Claude Code and fails to detokenize hands the client a file that does not exist; the tool loop then fails in confusing ways. The vault-per-session mechanism should cover it (request tokenized, response detokenized through the same handle), but coding traffic exercises tool_use/tool_result density the bridge traffic never did. Criterion: an e2e case with a non-empty ruleset where Claude Code reads a file whose path contains ruleset-matched content, and the round trip lands byte-identical on the client side. Also verify the default posture: for orgs with no ruleset the pipeline must be a true no-op on this path.

**Ancillary surface inventory.** Before building, capture what a current stock Claude Code actually calls against a base URL (messages, count_tokens, anything else — model listing, health probes). Implement or stub honestly; a stub that lies (fake token counts, fabricated model metadata) is worse than a 404. The existing `/models` endpoint returns Ekoa tier models — check whether Claude Code consumes it and whether the envelope satisfies it.

**Incoming beta headers.** The gateway ignores client HTTP headers today; in oauth mode the transport sets its own beta flags, and the body-level `betas` field is forwarded. Criterion: only build header pass-through if the live-client inventory shows a feature Claude Code needs that is header-gated and not expressible via the body field — and then as an allowlist in api-key mode only.

**Key store shape.** Follow the injected-seam pattern (`llm/` may not import `auth/`): key verification is a seam injected by the composition root, same as `verifyToken`. Keys carry: owner user id, org id, hashed secret, created/revoked timestamps, per-key cap config, last-used timestamp (anomaly surface). Settings UI: mint (show once), list, revoke. Criterion: the smallest schema that supports revocation and per-key caps; no scopes, no expiry policy machinery in v1.

**Abuse posture.** A metered Anthropic-compatible endpoint is a token-farming target. Per-key caps plus the existing pre-admission user caps are the v1 answer; anomaly flagging beyond `last-used` is out of scope but the field exists so it can be watched.

**Registo events.** Gateway turns should appear in the user's Registo like any other agent action (who, when, tier, token counts — never content). Criterion: reuse the existing attribution/tracker event path; if a new event type is needed, it is metadata-only.

**Caching hygiene (standing rule).** The gateway forwards client bodies as-is; keep it that way. Nothing per-turn-variable may be injected into regions the client marked with `cache_control` — Claude Code's cache hit rate is the user's cost profile.

## 4. Slices (sequencing suggestion, planning session owns the final cut)

1. **S1 — Heartbeat-and-replay.** SSE open + pings + buffered flush + in-stream error shape. Includes the long-turn liveness test (simulated slow upstream, assert pings on the wire and a live client surviving a multi-minute turn).
2. **S2 — Family mapping.** Mapping + reasoning-param handling + tier resolution tests for stock Claude Code model ids.
3. **S3 — count_tokens.** Endpoint + contract schema in `shared/` + contract test.
4. **S4 — Per-user keys.** Store, seam, settings surface, revocation, per-key caps, billee wiring, Registo events.
5. **S5 (decision-gated) — Model-field honesty.** Only if §3's criterion resolves it into v1.

Diagrams travel with each slice per the repo's standing rule (a structural change without its diagram update is incomplete), not as a final slice. Contract tests for every new endpoint in the same PR, per the five-layer QA process. PRs here touch billing and the LLM module, so the adversarial cross-model review gate applies.

## 5. Owner checks before build (not build tasks)

1. **Credential mode.** The chokepoint defaults to `oauth` (central subscription OAuth). Serving many users' Claude Code sessions through one subscription OAuth credential is the exposed posture; `api-key` mode (usage-billed provider key) is the defensible one for metered third-party-client traffic. Resolve mode + provider ToS review for this pattern at the current account tier before the run starts. This also gates the S5 decision.
2. **Pricing.** Gateway usage on the same meter as in-app usage, or a distinct SKU. The tracker attributes it either way; the product decision is what the user sees.

## 6. Non-goals (unchanged from the parked brief unless noted)

- Incremental token streaming (new: explicitly traded away for anonymisation integrity).
- OpenAI-compat endpoint (Codex, OpenCode, Pi) — later phase.
- Exact-model passthrough; users needing real provider behavior for development workflows use their own provider key.
- Targeting professional software developers as an audience promise. The audience is power users running Claude Code as a workhorse: process files, run research, build agents, produce deliverables.
- Inference resale / routing-marketplace behavior.
- Guided device-flow onboarding (exists in `auth/device.ts`, wire it up in a later polish pass).

## 7. Client configuration (end state)

```
ANTHROPIC_BASE_URL=https://<cortex-host>/api/v1/llm
ANTHROPIC_AUTH_TOKEN=<per-user gateway key>
```

Opus/sonnet/haiku requests land on EXPERT/WORKHORSE/FAST via family mapping; Claude Code's background small-model traffic lands on FAST naturally. No client-side model overrides required.
