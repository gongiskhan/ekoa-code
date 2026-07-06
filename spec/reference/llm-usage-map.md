# LLM Usage Map

Every call site in Cortex that reaches an Anthropic model today, traced through the LLM router and adapters. For each: purpose, effective model/tier, rough frequency, and its classification under the rebuild attribution scheme -- `user_work` (billable product surface: user builds, chat, user-requested agent runs via the Claude Agent SDK), `classifier` (intent/tier classification; stays, cheapest tier), or `platform` (everything else). Every platform-classified call carries an explicit fate: **becomes-code** (deterministic reimplementation), **moves-to-design-time** (LLM authors an artifact once, code executes it at runtime), or **dropped** (with reason). This map exists so the rebuild neither silently drops a billable surface nor re-inherits platform-overhead model spend.

**Method:** derived from source at commit `3882aa6` (`cortex/src/`, read-only); docs (CLAUDE.md, `docs/`) treated as hints only; every claim cited as `file:line`; two independent code sweeps merged and spot-re-verified against the code (all verified claims matched). Code-vs-doc contradictions are recorded in the Conflicts section, never resolved silently.

---

## 1. Attribution scheme

| Class | Definition | Rebuild disposition |
|---|---|---|
| `user_work` | Billable product surface: user builds, chat, user-requested agent runs via the Claude Agent SDK | Stays; billed to the requesting user (or artifact owner) |
| `classifier` | Intent / tier / closed-enum classification calls | Stays; pinned to the cheapest tier (Haiku), each with a deterministic fallback |
| `platform` | Everything else (background, maintenance, convenience, aesthetics) | Elimination candidate; explicit fate required per call |

---

## 2. Transport chokepoints

Every Anthropic token leaves the process through one of three transports, all consuming the same Supabase-managed OAuth token (`cortex/src/services/claude-auth.ts:196-241`):

| # | Transport | File | Mechanism | Models reachable | Self-metering |
|---|---|---|---|---|---|
| T1 | Claude Agent SDK subprocess | `cortex/src/adapters/external.ts:1163` (`query()`); pre-warm `startup()` at `external.ts:92` | `@anthropic-ai/claude-agent-sdk`, OAuth via `CLAUDE_CODE_OAUTH_TOKEN` env (`external.ts:145`) | All tiers (Haiku/Sonnet/Opus) -- the SDK subprocess is the only strong-model path on managed OAuth | Yes -- single auto-bill block at `external.ts:1356-1384` when `userId`+`agentType` set |
| T2 | Direct REST fetch | `cortex/src/anthropic-client.ts:82` (`callAnthropic()`); URL at `anthropic-client.ts:63` | Raw `fetch` to `api.anthropic.com/v1/messages?beta=true` with OAuth Bearer + `anthropic-beta: claude-code-20250219,oauth-2025-04-20` (`anthropic-client.ts:65-70`); one forced-refresh retry on 401 (`:114-123`) | **Haiku only in practice** -- OAuth-direct returns 400 for Sonnet/Opus (`llm-gateway.ts:319-334`) | No -- callers meter manually (`turn-classifier.ts:19-20`) |
| T3 | LLM Gateway proxy | `cortex/src/llm-gateway.ts:283` (`registerLlmGateway`, mounted `server.ts:443`) | `node:https` pass-through to Anthropic (`llm-gateway.ts:368-374`), OAuth injected (`:353`) | **Clamped to Haiku** -- `wireTier = LlmTier.FAST` (`llm-gateway.ts:333`) regardless of router classification | Yes -- `meterGatewayUsage` (`llm-gateway.ts:224-255`) |

A fourth direct-`query()` site reuses T1's env wiring: `cortex/src/agent-face/index.ts:217` (agent-face runs its own SDK loop; tools RPC'd to the ekoa-local daemon; self-meters at `agent-face/index.ts:329-353`). `agent-face/validate-oauth-tools.ts:90` also calls `query()` but is a build-time validation harness, never a serving path.

One-shot convenience wrapper on T1: `callSimpleLlm(opts)` (`external.ts:1615-1673`) -- non-streaming, `skipMemory: true`, default tier `LlmTier.FAST` when the caller passes none (`external.ts:1644`), supports `effortOverride` and `imageAttachments`. **Hazard:** returns `''` on user abort rather than throwing (guard at `handlers/execute-handler.ts:229-236`).

**The OAuth asymmetry is load-bearing:** direct REST authorizes Haiku only; the SDK subprocess authorizes all tiers (`llm-gateway.ts:18-20, :319-334`; `vision.ts:12-15`). This is why the gateway clamps to Haiku and why vision/planner route one-shot calls through the SDK. A rebuild that replaces the Agent SDK must re-solve strong-model access.

---

## 3. Router tiers (`cortex/src/llm-router.ts`)

Models (`llm-router.ts:95-97`): `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-8[1m]`.

| Tier | Model | maxOutputTokens | sdkEffort (`:130-135`) | Billing weight (`billing/constants.ts:34-55`) |
|---|---|---|---|---|
| FAST | Haiku 4.5 | 4096 | low | 0.02 |
| REASONING_LIGHT | Haiku 4.5 | 8192 | low | 0.02 |
| WORKHORSE | Sonnet 4.6 | 16384 | medium | 0.1 |
| EXPERT | Opus 4.8 [1m] | 16384 | high | 0.4 |

- `classify()` (`llm-router.ts:237-375`): priority = complexityHint > previousFailures > estimatedFileCount > keyword scoring; default FAST. `classifyForSdk()` (`:410-432`) adds a tier floor and returns the full `RouterDecision`.
- `escalate()` (`llm-router.ts:388-401`) is a **dead export** -- zero callers (grep-verified); no caller passes `previousFailures` either.
- **Thinking budgets are dead on the wire:** `TIER_CONFIGS[*].thinking.budgetTokens` (`llm-router.ts:106-121`) is never serialized into any request; only the SDK `effort` param goes out (`external.ts:1065`). The gateway passes client bodies verbatim, so a T3 client could set thinking itself (`llm-gateway.ts:308-311`).
- `config.external.model` default is `claude-opus-4-8[1m]` (`config.ts:72`) -- a latent no-router fallback inside `external.ts:1041`; every current streaming caller passes a routerDecision, so it is not live traffic.

---

## 4. Master summary table

All 26 runtime call sites plus 1 dev harness. "Works w/o LLM" = a committed deterministic path already exists.

| # | Call site | Purpose | Transport | Effective model/tier | Frequency | Attribution | Fate |
|---|---|---|---|---|---|---|---|
| 1 | `cortex/src/index.ts:733` | Unified Chat turn (agentType `chat`) | T1 stream | Sonnet floor, Opus if classified EXPERT (`index.ts:412-416`) | per chat message | user_work | stays |
| 2 | `cortex/src/handlers/execute-handler.ts:1159` | App build / follow-up build (agentType `build`) | T1 stream | Always Opus (EXPERT floor, `execute-handler.ts:830-834`) | per build job | user_work | stays |
| 3 | `cortex/src/handlers/execute-handler.ts:1491` | Assistant-chat for built apps (`assistant-chat`) | T1 | Haiku/Sonnet/Opus by greeting/knowledge heuristic (`:1473-1477`) | per end-user message to an assistant artifact | user_work | stays |
| 4 | `cortex/src/handlers/integration-builder-handler.ts:139` | AI integration-builder chat (`integration-builder`) | T1 stream | Sonnet (hint medium wins; `isCodeGen` dead, `:135`) | per builder chat message | user_work | stays |
| 5 | `cortex/src/handlers/branding-handler.ts:653` | Brand-research synthesis agent (`brand-research`, text-only, no tools) | T1 stream | Sonnet (hint medium, `:346`) | 1x per `start-research` | user_work | stays |
| 6 | `cortex/src/agent-face/index.ts:217` | Strong-model TUI agent face, daemon-RPC tools (`agent-face`) | T1-adjacent `query()` | Effectively always Opus (hint 'high' -> EXPERT; floor at `:155` inert) | per escalated TUI turn | user_work | stays |
| 7 | `cortex/src/llm-gateway.ts:283` (`POST /api/v1/llm/messages`) | Anthropic-compatible proxy for ekoa-local Pi fast loop (`pi-fast-loop`) | T3 | Clamped to Haiku (`:333`) | N per TUI turn | user_work | stays |
| 8 | `cortex/src/automation/planner.ts:233` | Goal -> Step[] automation plan (`automation-plan`) | T1 `callSimpleLlm` | Opus, effort max | 1-2x per plan-from-goal | user_work | stays |
| 9 | `cortex/src/automation/rehearsal.ts:173` | Rehearsal failure -> plan patch (`automation-rehearse`) | T1 + image | Opus, effort max | per recoverable rehearsal step failure (budgeted) | user_work | stays |
| 10 | `cortex/src/services/vision.ts:264` | Screenshot -> Playwright action resolve (`vision-resolve`) | T1 + image | Opus, effort max (pinned; `tier` input ignored `:243`) | per browser step on action-cache miss | user_work | stays |
| 11 | `cortex/src/services/vision.ts:405` | Screenshot -> outcome verify + cacheable assertion (`vision-verify`) | T1 + image | Opus, effort max (pinned) | per verify step on assertion-cache miss | user_work | stays |
| 12 | `cortex/src/services/in-build-answer.ts:126` | Answer user question about current build (`answer-about-build`) | T1 `callSimpleLlm` | Haiku FAST | per question-about-build turn | user_work | stays |
| 13 | `cortex/src/services/in-build-answer.ts:150` | Answer platform question mid-build (`answer-about-ekoa`) | T1 `callSimpleLlm` | Haiku FAST | per question-about-ekoa turn | user_work | stays |
| 14 | `cortex/src/services/artifact-backend/runtime.ts:706` | `ekoa.llm` capability for artifact backends (`artifact-backend:<entrypoint>`) | T1 `callSimpleLlm` | Haiku FAST (no tier passed -> default, `external.ts:1644`) | per backend invocation using `ekoa.llm` | user_work | stays (billed to artifact owner) |
| 15 | `cortex/src/services/orchestrator.ts:253` | Build-intent classify (`detect-build-intent`) | T1 `callSimpleLlm` | Haiku FAST | per gathering-phase message (parallel w/ 16, `orchestrator.ts:402-405`) | classifier | stays (keyword fallback `:267-278`) |
| 16 | `cortex/src/services/orchestrator.ts:294` | Integration-needs detect (`detect-integration-needs`) | T1 `callSimpleLlm` | Haiku FAST | per gathering-phase message | classifier | stays (keyword fallback `:311-336`) |
| 17 | `cortex/src/services/orchestrator.ts:349` | Base-template select (`select-base-template`) | T1 `callSimpleLlm` | Haiku FAST | per gathering message only while `base` is unset (sequential after 15+16, `orchestrator.ts:421-423`) + build kickoff w/o base (`execute-handler.ts:429-433`) | classifier | stays (keyword fallback `:367-385`) |
| 18 | `cortex/src/services/orchestrator.ts:580` | In-build follow-up intent classify (`classify-in-build-intent`) | T1 `callSimpleLlm` | Haiku FAST | every follow-up message on an existing artifact (`execute-handler.ts:222`) | classifier | stays (heuristic fallback `:600`; abort guard mandatory) |
| 19 | `cortex/src/services/turn-classifier.ts:162` | TUI turn tier classification (`classify-tui-turn`) | T2 REST | Haiku FAST, max_tokens 300, 3.5s budget | per TUI turn (`llm-gateway.ts:484-526`) | classifier | stays (keyword mode via `EKOA_TUI_CLASSIFY_MODE`; auto-fallback on failure) |
| 20 | `cortex/src/services/vision.ts:345` | Human-action page classify: CAPTCHA/MFA/login (`vision-classify-human-action`) | T1 + image | Haiku FAST | on automation step failure when regex layers miss (`engine.ts:617-651`) | classifier | stays (regex fast-path is the deterministic layer) |
| 21 | `cortex/src/apps/compiler.ts:67` | Compile recipe `instructions.md` -> `recipes.json` (`recipe-compile`) | T1 `callSimpleLlm` | Haiku FAST | startup per recipe app missing recipes.json + manual `POST /api/apps/:appId/compile` | platform | **moves-to-design-time** |
| 22 | `cortex/src/apps/handler.ts:86` | Tier-2 LLM fallback for unmatched recipe actions (`recipe-fallback`) | T1 `callSimpleLlm` | Haiku REASONING_LIGHT (only user of this tier) | per unmatched recipe-app action (rare) | platform | **dropped** |
| 23 | `cortex/src/memory/auto-extractor.ts:213` | Extract org memories from conversations (`memory-extract`) | T1 `callSimpleLlm` | Haiku FAST | fire-and-forget after every chat turn / build / assistant-chat (config-gated) | platform | **dropped** (from baseline) |
| 24 | `cortex/src/memory/consolidation.ts:308` | Merge duplicate memories per tag group (`memory-consolidate`) | T1 `callSimpleLlm` | Haiku FAST | manual admin intent, 1 call per tag group | platform | **becomes-code** |
| 25 | `cortex/src/services/slug-generator.ts:153` | 2-4-word URL slug (`slug-gen`) | T1 `callSimpleLlm` | Haiku FAST | per new artifact + forks/imports (`execute-handler.ts:1019`, `artifacts-handler.ts:672,727`, `server.ts:3284`) | platform | **becomes-code** |
| 26 | `cortex/src/services/visual-vibe.ts:218` | Vision "vibe" analysis of brand screenshots (unbilled) | T2 REST + image | Haiku hardcoded (`visual-vibe.ts:56`), max_tokens 600 | 1x per brand-research run (fire-and-forget) | platform | **dropped** |
| 27 | `cortex/src/agent-face/validate-oauth-tools.ts:90` | Build-time OAuth/tool-swap validation harness | `query()` (dev only) | n/a | never in serving path | n/a (not runtime) | not carried into the rebuilt service |

Non-call plumbing (no fate needed): SDK subprocess pre-warm `startup()` (`external.ts:87-100`, zero tokens); Anthropic OAuth token refresh loop (`claude-auth.ts:196-241`, token maintenance, zero tokens); gateway `GET /api/v1/llm/models` (`llm-gateway.ts:458-470`, static list, no model call).

---

## 5. user_work detail (14 sites -- the billable product surface)

These are the product; none is replaceable by code. All are billed through the adapter auto-bill (`external.ts:1356-1384`) except #6 (self-metered, `agent-face/index.ts:329-353`; cancelled runs unbilled by design `:355-364`) and #7 (gateway-metered at wire tier, `llm-gateway.ts:224-255`).

Notable per-site facts a rebuild must preserve:

- **Chat (#1):** memory injection (`external.ts:865-871`), knowledge grounding always in chat mode (`external.ts:886-898`), keyword-triggered integration data pre-fetch into the system prompt (`external.ts:167-302, :937-985`), agentic knowledge tools restricted to `mcp__ekoa-knowledge__*` -- never Bash/Write (`external.ts:1016-1034`). Fire-and-forget memory extraction rides each turn (`index.ts:652-656`) -- see platform #23.
- **Build (#2):** EXPERT floor means always Opus; full `claude_code` tool preset + `bypassPermissions` (`external.ts:682-714`); session persist/resume (`external.ts:1063-1064, :1202-1213`); wall-clock cap 40 min, inactivity 5 min (`execute-handler.ts:1132-1135`); knowledge grounding only when `isLegalBuildContext`.
- **Assistant-chat (#3):** tier picked by a greeting regex + knowledge/web-presence heuristic (`execute-handler.ts:1473-1477`) -- a deterministic pre-classifier in front of a user_work call.
- **Brand research (#5):** deliberately tool-less (no Bash/Read) so a prompt-injected agent cannot launder cortex config back as "the brand" (`branding-handler.ts:650-652`). Consumes 4 deterministic signal passes plus the visual-vibe output (platform #26).
- **Automation runtime (#8-11):** vision resolve/verify are pinned Opus effort-max via SDK because the REST path is Haiku-capped (`vision.ts:12-15`). The **action/assertion cache** (`automation/cache.ts`, keyed by `(automationId, stepId, pageFingerprint)`) is the already-built "moves-to-design-time" mechanism for repeat runs: full-cache-hit runs consume zero tokens. Outputs validated against closed vocabularies (`vision.ts:466-515`; `planner.ts:253-256`; `rehearsal.ts:4-9`).
- **In-build answers (#12, #13):** answer a user's direct question; `ABOUT_EKOA_SYSTEM` hardcodes a canonical platform capability list (`in-build-answer.ts:51-73`) that the rebuild must keep in sync or answers will lie.
- **Artifact-backend `ekoa.llm` (#14):** worker cannot choose billee or tier (`services/artifact-backend/handle-rpc.ts:15, :74-75, :153-159`); billed to the artifact owner with `billingArtifactId`.
- **Gateway proxy (#7):** router classification is telemetry-only; the wire model is always Haiku (`llm-gateway.ts:332-334`); heavy work escalates to agent-face (#6) instead -- the two-driver split.

---

## 6. classifier detail (6 sites -- stay, cheapest tier)

All six are already Haiku-FAST and all six have a committed deterministic fallback, so an LLM outage degrades accuracy but never blocks:

| Site | Deterministic fallback | Notes |
|---|---|---|
| `orchestrator.ts:253` detectBuildIntent | keyword verbs/nouns regex (`:267-278`) | one gathering message fires 15+16 **in parallel** (`orchestrator.ts:402-405`) = 2 Haiku calls, plus 0-1x **sequential** base-select (17) afterwards only while `base` is unset (`:421-423`) -- typically just the first gathering message |
| `orchestrator.ts:294` detectIntegrationNeeds | keyword -> category map (`:311-336`); LLM output filtered to closed enum (`:304`) | |
| `orchestrator.ts:349` selectBaseTemplate | keyword -> base map (`:367-385`); validated against closed `BASE_IDS` (`:358`) | borderline platform/becomes-code; kept classifier because it is closed-enum selection with the fallback already committed |
| `orchestrator.ts:580` classifyInBuildIntent | `fallbackInBuildIntent` heuristic (`:600, :611`) | runs before EVERY follow-up on a build session; abortable -- abort returns `''`, guarded at `execute-handler.ts:233-236`. **The rebuild MUST preserve this abort guard** or a user Stop becomes a heuristic "modification" that launches a build |
| `turn-classifier.ts:162` classify-tui-turn | keyword mode (`EKOA_TUI_CLASSIFY_MODE=keyword`, `llm-gateway.ts:497-503`) + automatic fallback on any failure (`turn-classifier.ts:85-93, :181-194`) | direct REST (T2), manually metered (`:100-131`); chose REST over SDK because SDK subprocess costs 3.2-8.3s/call (`:14-18`); 3.5s hard budget (`:31, :175-185`) |
| `vision.ts:345` classifyHumanAction | regex layer `detectHumanActionable` (`engine.ts:617-619`) catches most cases first | borderline user_work (runs inside a billable automation run, billed to the user); kept classifier: closed-enum, cheapest tier, tail-catcher only |

---

## 7. platform detail -- every call with an explicit fate

| # | Call | Fate | Rationale |
|---|---|---|---|
| 21 | Recipe compile (`apps/compiler.ts:67`) | **moves-to-design-time** | The LLM authors `recipes.json` once from `instructions.md`; runtime only loads JSON. The 3 bundled recipe apps already ship compiled recipes -- make committed compiled artifacts the contract and run compilation as an authoring-time step (CLI/dev tool), not a startup path. Currently billed to the platform owner (`compiler.ts:64-69`). |
| 22 | Recipe tier-2 action fallback (`apps/handler.ts:86`) | **dropped** | An LLM improvising a prose "answer" to an unmatched CRUD/mutation intent is a correctness hazard, not a feature. Return a structured error for unmatched intents. Reason confirmed in code: it fires when no recipe matches or recipe execution failed (`apps/handler.ts:58-64`). Only call site using REASONING_LIGHT -- dropping it also retires that tier. |
| 23 | Memory auto-extract (`memory/auto-extractor.ts:213`) | **dropped** (from the platform baseline) | Not user-requested -- background overhead riding every chat turn (`index.ts:652-656`), build (`execute-handler.ts:1099-1102`), and assistant-chat (`execute-handler.ts:1526-1534`), ~1 Haiku call per conversation turn. Already config-gated (`config.ts:116-118`) and the product fully works with it off. Semantic extraction cannot become code; if organizational memory learning is wanted in the rebuild, re-ship it as an explicit user-invoked action (which reclassifies it as user_work), not an ambient tax. |
| 24 | Memory consolidation (`memory/consolidation.ts:308`) | **becomes-code** | Grouping is already deterministic (2+ shared tags, `:289-297`); replace the per-group Haiku merge with deterministic near-duplicate merging (string similarity within tag groups) for the manual admin intent (`memory-handler.ts:359`). Accepted quality loss on subtle merges; feature is optional maintenance either way (`config.ts:113-115`). |
| 25 | Slug generation (`slug-generator.ts:153`) | **becomes-code** | The committed deterministic `fallbackSlug()` (`slug-generator.ts:107-119, :179-187`) plus deterministic collision resolution (`:75-90`) already produce working slugs on every LLM failure; the model only improves aesthetics. Ship the fallback as the only path. |
| 26 | Visual-vibe (`visual-vibe.ts:218`) | **dropped** | Unbilled (no `recordTokenUsage` anywhere in the file), bypasses the router with a hardcoded model (`:56`), and entirely non-fatal by design (null on any failure, `:12-14, :77-93`) -- the deterministic extractors (HTML scrape, rendered candidates, dembrandt) already carry the exact colors/fonts. If the subjective vibe signal is wanted, attach the 1-3 screenshots to the brand-research SDK session (#5) instead -- zero extra call, and it becomes properly billed user_work. |

No platform call is left without a fate.

---

## 8. Billing metering points (cross-check for the billing spec)

1. **Adapter auto-bill** (`external.ts:1356-1384`) -- covers sites 1-5, 8-18, 20-25. Weighted by `resolveTierWeight` (`billing/tracker.ts:106`); cache reads at `CACHE_READ_BILLING_FACTOR = 0.25` (`billing/constants.ts:43`). Callers must not double-bill (`external.ts:770-775`).
2. **Agent-face self-meter** (`agent-face/index.ts:329-353`) -- site 6; bypasses the adapter's meter deliberately (comment `:46-49`); cancelled runs unbilled (`:355-364`).
3. **Gateway meter** (`llm-gateway.ts:224-255`) -- site 7; bills at the **wire** tier (Haiku), not the router's nominal classification (`:220-223`); JWT principal or platform owner for API-key principals (`:94-98`).
4. **Turn-classifier manual meter** (`turn-classifier.ts:100-132`) -- site 19.
5. **Unbilled:** visual-vibe (site 26, by omission); recipe compile bills the platform owner (site 21); cancelled agent-face runs (by design); SDK pre-warm (no tokens).
6. **Nuance:** `DEFAULT_BILLING_WEIGHT` = Sonnet weight for records lacking tier info (`billing/constants.ts:57-62`), but `callSimpleLlm` always synthesizes a routerDecision defaulting to FAST (`external.ts:1644`), so e.g. site 14 bills at FAST weight, not the default.
7. **Provisional in-flight tick:** debounced (1s) `usage_progress` SSE from streaming `message_delta` usage (`external.ts:1178-1200, :1241-1249`); end-of-call `recordTokenUsage` is the source of truth.

---

## 9. Frequency profile (rebuild sizing)

- **Per chat message:** 1x streaming Sonnet+ (site 1) + 1x Haiku memory-extract (site 23, fire-and-forget, slated dropped).
- **Per build job:** 0-1x Haiku base-select (17) + 1x streaming Opus build (2) + 1x Haiku slug (25, first build; slated becomes-code) + 1x Haiku memory-extract (23). Each follow-up message adds 1x Haiku in-build classifier (18) and possibly 1x Haiku answer (12/13) instead of a rebuild.
- **Per automation run:** 0x on full cache hit; per cache-missed step 1x Opus-max resolve (10) and/or 1x Opus-max verify (11); stuck steps add 1x Haiku human-action classify (20); rehearsal failures add 1x Opus-max patch (9, budget-capped).
- **Per automation created from goal:** 1-2x Opus-max plan (8; corrective retry on validation failure, `planner.ts:194-229`).
- **Per TUI turn (ekoa-local):** 1x Haiku REST classify (19) + either N gateway-proxied Haiku calls (7) or 1x agent-face Opus run (6).
- **Per gathering-phase message (guided build):** 2x Haiku in parallel (15, 16; `orchestrator.ts:402-405`) + 0-1x sequential Haiku base-select (17) only while `base` is unset (`orchestrator.ts:421-423`) -- typically just the first gathering message; later messages fire only the 2 parallel calls.
- **Per brand-research run:** 1x Haiku visual-vibe (26, slated dropped) + 1x Sonnet synthesis agent (5).
- **Startup:** recipe compile per missing recipes.json (21, slated design-time); SDK pre-warm on first use (no tokens).
- **Admin-manual:** memory consolidation (24, slated becomes-code).
- **Cron-driven LLM calls: none.** The hourly sweep at `index.ts:844` refreshes platform-integration OAuth (Google/Microsoft), not Anthropic; the Anthropic token refresh loop consumes zero tokens.

---

## 10. Confirmed no-LLM areas (do not hallucinate model calls here)

- **Knowledge flows:** FTS5/ripgrep search, ranking, snippets, crawl, ingest, upload -- all deterministic. `services/knowledge-extract.ts:50` `extractText` is officeparser file-to-text; `anthropic-client.ts:137` `extractText` is a response-block picker -- name collision, no LLM. The `knowledge_search`/`knowledge_read` MCP tools (`adapters/knowledge-mcp.ts`) are deterministic tool implementations consumed by agents.
- **Memory retrieval:** term-overlap scorer (`memory/resolver.ts`), no model call.
- **Wizard inference** (`ekoa.execute/infer-integrations`): pure keyword matcher (`services/integration-inference.ts:29-49`; handler `execute-handler.ts:1315-1337`, "legacy classifier kept for API compatibility" `:1309-1312`).
- **Legal vertical:** pure calculators and deterministic HTTP (`legal/simuladores.ts`, `services/legal-calculos.ts`, `legal-research.ts`, `citius-*`, `ctt-tracking`); `cmd-signature.ts` inactive scaffolding.
- **STT** (`services/stt-provider.ts`): interface + stubs; `mock` is the only working engine (`:106-119`); `whisperx`/`elevenlabs` throw (`:138-142, :157-166`). If live STT ships it is a non-Anthropic dependency, metered at a flat `stt:<engine>` rate (`:203-221`; `billing/constants.ts:99-108`).
- **`tools/`** (18 files): no direct model calls; `call-automation` etc. trigger flows that themselves use vision/planner.
- **Prompt-composition modules:** `agents/plugin-loader.ts`, `services/onboarding-prompt.ts`, `starting-points-prompt.ts`, `knowledge-prompt.ts`, `automation/catalog.ts`, `automation/manifest-parser.ts` -- context assembly only.
- **`services/integration-agent.ts`:** session bookkeeping only, zero adapter calls. `services/integration-session-capture.ts`: browser capture, no LLM.
- **Frontend (`ekoa/`):** zero direct model usage (full grep); `lib/sanitize-error.ts:8-23` is a provider-identity scrub list; `lib/conversation-types.ts` / `lib/template-inference.ts` are local keyword classifiers. All AI reaches the frontend via cortex HTTP+SSE.

---

## Conflicts

Code-vs-doc contradictions and code-internal hazards found during the sweeps. The two finder sweeps agreed on all substantive facts (only immaterial line-range phrasing differences); all discrepancies below are code-vs-docs or code-vs-comments, spot-re-verified against source.

1. **CLAUDE.md tier-table model IDs are stale:** says `claude-haiku-4` / `claude-sonnet-4` / `claude-opus-4`; code has `claude-haiku-4-5-20251001` / `claude-sonnet-4-6` / `claude-opus-4-8[1m]` (`llm-router.ts:95-97`; `config.ts:72`).
2. **CLAUDE.md automation "cache -> Vision(Sonnet) -> Vision(Opus)" three-tier loop is stale:** both vision resolve and verify are pinned to EXPERT/Opus at effort max; the `tier`/`VisionTier` input is explicitly ignored (`vision.ts:243` `void input.tier;`, `:264-273`, `:405-415`; header `vision.ts:12-15`). The actual loop is two-tier: cache -> Opus. The only Haiku in the loop is the human-action classifier (`vision.ts:345`).
3. **`vision.ts:12` and `:243` comments say "Opus 4.7"** while the router pins `claude-opus-4-8[1m]` (`llm-router.ts:97`) -- stale comments.
4. **CLAUDE.md "Direct API calls (recipe compilation, action fallback, wizard inference) use classify() + getModelConfig()" is stale:** recipe compilation and action fallback now go through `callSimpleLlm` (SDK path; `external.ts:1608-1613` "Replaces direct callAnthropic() usage"); wizard inference is a pure keyword matcher with no LLM at all (`integration-inference.ts:29-49`). The only remaining direct-REST callers are turn-classifier and visual-vibe.
5. **Thinking budgets are dead on the wire:** `TIER_CONFIGS[*].thinking.budgetTokens` (`llm-router.ts:106-121`) is never serialized; only the SDK `effort` param is sent (`external.ts:1065`). CLAUDE.md's "Haiku (extended thinking)" tier describes intent, not wire behavior.
6. **`escalate()` (`llm-router.ts:388-401`) has zero callers** (grep-verified) and no caller passes `previousFailures` -- the documented "automatic fallback when a lower tier fails" is not wired anywhere; `llm-gateway.ts:322-324` confirms "the escalate-on-400 path was never implemented".
7. **OAuth model-access asymmetry:** direct REST on managed OAuth authorizes Haiku only (Sonnet/Opus return 400, "confirmed live 2026-05-31", `llm-gateway.ts:319-334`); the SDK subprocess authorizes all tiers. Environmental constraint of the managed-OAuth account class -- load-bearing for any rebuild that replaces the Agent SDK.
8. **`agent-face/index.ts:154` comment ("floor at WORKHORSE... let classification escalate") is wrong:** `complexityHint:'high'` deterministically yields EXPERT (`llm-router.ts:247-248`), so the floor never binds -- agent-face is always Opus.
9. **`integration-builder-handler.ts:135`: `isCodeGen:true` is dead weight** -- `complexityHint:'medium'` short-circuits classification to WORKHORSE (`llm-router.ts:241-253`). Integration skill code-gen runs on Sonnet, not Opus, despite the code-gen flag.
10. **visual-vibe is unbilled and router-bypassing:** direct `callAnthropic` with a hardcoded model (`visual-vibe.ts:56, :218-227`) and no `recordTokenUsage` anywhere in the file -- silent platform overhead, contradicting both the router's "single source of truth" contract (`llm-router.ts:2-6`) and the billing model.
11. **Abort-semantics hazard:** `callSimpleLlm` returns `''` on user abort instead of throwing; classifier callers must re-check abort or a Stop becomes a fallback-heuristic "modification" that starts a build (`execute-handler.ts:229-236, :310-315`). The rebuild must preserve this guard.
12. **`DEFAULT_BILLING_WEIGHT` comment mismatch:** `billing/constants.ts:57-62` says the Sonnet-weight default covers "legacy callSimpleLlm paths that don't pass a tier", but `callSimpleLlm` itself defaults the tier to FAST (`external.ts:1644`); the Sonnet default only applies when tier info is absent from the billing record in the tracker.
13. **`config.external.model` default is Opus** (`claude-opus-4-8[1m]`, `config.ts:72`) -- the no-router fallback inside `external.ts:1041` defaults to the most expensive model; latent (all current streaming callers pass a routerDecision), but a rebuild should not inherit an Opus default.
14. **CLAUDE.md lists `template-converter-handler.ts` / template conversion:** no such file or `convertTemplate` symbol exists (grep-verified) -- stale doc entry, no LLM call to map.
15. **`orchestrator.ts:389-390` docstring ("Runs all three Haiku skills in parallel, then evaluates the gate") is wrong:** the code beneath it runs a 2-way `Promise.all` of detectBuildIntent + detectIntegrationNeeds only (`orchestrator.ts:402-405`); selectBaseTemplate runs sequentially afterwards and only when `current.base` is null (`:421-423`). Stale comment -- the actual per-message cost is 2 parallel Haiku calls + 0-1 sequential base-select.

No unresolved finder-vs-finder conflicts remain.
