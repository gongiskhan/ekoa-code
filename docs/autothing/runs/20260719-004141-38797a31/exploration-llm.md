Exploration complete. Full report below. No `.codegraph/` at the repo root, so this is from direct reads. All paths absolute.

# 1. LLM module (`api/src/llm/`) — how to make a one-shot call
Public entry: `api/src/llm/index.ts` (the ONLY importable file from outside `api/src/llm/`; lint + grep gate enforced).

Chokepoint entries, all in `api/src/llm/client.ts`, all take `attribution` as a required positional 2nd arg:
- `runAgent(opts, attribution)` — streaming Agent SDK, tools, resume (`client.ts:713`).
- `runOneShot(opts, attribution)` — non-streaming, tool-less, any tier (`client.ts:878`).
- `completeFast(opts, attribution)` — direct Messages REST, FAST tier ONLY by type (options type can't express a higher tier, `client.ts:925-937`); tool-less, cheapest, one 401-refresh retry (`client.ts:944`).

For a cheap read-only side-question, `completeFast` is the intended primitive. Template to copy: `api/src/agents/guided-build.ts:20-26` — `completeFast({ messages, system, maxTokens, signal }, { kind:'classifier', agentType:'classify-in-build-intent', billeeUserId })`. Other patterns: `api/src/memory/extraction.ts:95` (runOneShot FAST), `api/src/agents/brand-research.ts:299` (runOneShot strong tier). If it needs a bigger model or a single prompt string, use `runOneShot({ prompt, systemPrompt, decision })`.

Tiers (`api/src/llm/router.ts:23-25`): FAST | WORKHORSE | EXPERT. Model ids live only in `api/src/config.ts:103-108` — FAST=claude-haiku-4-5-20251001/low/0.02, WORKHORSE=claude-sonnet-5/medium/0.1, EXPERT=claude-opus-4-8[1m]/high/0.4. Pick via `decideForTier(tier)` (`router.ts:179`) or `decideForTask(desc, ctx?, minTier?)` (`router.ts:188`). `runAgent`/`runOneShot` require a `RouterDecision` (no default); `completeFast` needs none.

Attribution (`api/src/llm/attribution.ts:55-73`): union `user_work` (needs billeeUserId; optional artifactId/sessionId/runId) | `classifier` (needs billeeUserId) | `platform` (zero legit call sites; trips a /health anomaly counter). Metering fires once per completed call via `meter()` (`client.ts:615`) → `billing/tracker.recordTokenEvent`. Callers can't meter because they can't reach the transport.

KEY FINDING: `UserWorkAgentType` already declares `'answer-about-build'` and `'answer-about-ekoa'` with ZERO call sites (`attribution.ts:31-32`) — pre-reserved for exactly this read-only Q&A-about-a-run feature. Use `{ kind:'user_work', agentType:'answer-about-build', billeeUserId, sessionId, runId }` — no new tag, no ledger migration. Adding a brand-new tag means editing this union (the billing-breakdown contract).

Anonymisation (`api/src/llm/anonymise/`, driven from `client.ts:144-180`, `746-848`): automatic. Every entry anonymises model-bound text before the transport and de-tokenises the response, keyed by a session vault `csid:<org>:<sessionId>` for user_work-with-sessionId, else an ephemeral per-call vault cleared at end (`client.ts:155-167`). Passing a sessionId shares that session's vault.

# 2. Chat turn path + message record
Route→handler→llm: `api/src/routes/chat.ts:34-57` (POST /api/v1/chat/runs → createChatRun → 202 {runId} → fire-and-forget executeChatRun; SSE at `/runs/:id/events` with ?token= + Last-Event-ID). `api/src/agents/chat.ts:69-282` executeChatRun: billing gate → persistUserMessage → assembleRunContext → `decideForTask(message,…,'WORKHORSE')` floor (`chat.ts:137`) → runAgent with `{kind:'user_work',agentType:'chat',billeeUserId,sessionId,runId}` (`chat.ts:158-173`).

History: load via `api/src/agents/context.ts:45-64` loadHistory (reads `messages` store by timestamp, filters provider-error turns, tail-dedups); `renderPrompt` (`context.ts:130-134`) wraps as `<conversation><turn>…</turn></conversation>`. Store via `api/src/agents/persistence.ts:15-37` `{_id,sessionId,role,content,timestamp,metadata?}`.

Message schema `shared/src/sessions.ts:6-16` SessionMessage (`.passthrough()`): id, sessionId, role(z.string()), content(z.string()), metadata(z.record(z.unknown()).optional()), createdAt. Wire projection `api/src/services/platform-crud.ts:88-99` maps _id→id, timestamp→createdAt, passes role/content/metadata through.

Mark a side-question WITHOUT a parallel storage path — two clean options: (1) `metadata.kind='side-question'` — free passthrough record, zero schema change; (2) a new `role` string (role is a bare z.string(), not an enum). Note loadHistory would include a new role unless filtered — so if side-questions must NOT pollute future chat prompts, mark in metadata and skip them in loadHistory (mirror the existing `providerError` filter at `context.ts:50`).

# 3. Job trace / running transcript — THE MAIN GAP
There is NO persisted transcript store for a running job. Streamed text/tool events flow only through the SSE manager: `api/src/agents/streaming.ts` JobStreamSink/ChatStreamSink → `sseManager.emit(...)`. The only server-side store while running is an in-memory replay ring: `api/src/events/sse-manager.ts` `rings: Map<'${stream}:${id}', StreamEvent[]>` capped at REPLAY_RING=200 events/stream (`sse-manager.ts:9,61-71`) — it exists for Last-Event-ID reconnect, is not queryable, and SseManager exposes no getter. Retention caveat: the header comment says "swept after 300s idle" (`sse-manager.ts:3`) but the class has NO such timer — in practice it holds the last ≤200 events in memory for the process lifetime, evicted only by the 200-cap shift.

The persisted JobRecord (`api/src/agents/jobs.ts:20-54`, `jobs` collection) stores status/routing/result/error/timestamps — NOT the streamed chunks/tool events. Chat runs persist nothing to a collection (only the final assistant message); the live run is in-memory in `api/src/agents/registry.ts`.

Job event types (`shared/src/events.ts:57-102` JobEvent): ready, routing, text_chunk, thinking_chunk, tool_event{phase:started|finished|failed,tool,args?,result?,isError?,durationMs?}, context_event, plan_step, preview_reload, artifact, complete, error. Chat stream (events.ts:11-54) adds local_activity + delegate-on-complete.

Implication: grounding a side-question in a LIVE job's transcript has no read API and no durable store today. A feature must either tap the in-process run signal (runAgent callbacks / the sink), read the 200-event ring (needs a new getter), or add a real per-run transcript buffer. Option 3 is the honest answer if the transcript must survive past 200 events or be queried mid-run.

# 4. Follow-up-instruction-queued-during-run path — DOES NOT EXIST as described
Searched agents/, routes/, streaming.ts. No queue-instruction-and-apply-on-finish mechanism. What exists and is easy to confuse: (a) follow-up BUILD = a whole new job editing an existing artifact, gated by a one-per-artifact 409 DUPLICATE_BUILD (`api/src/agents/registry.ts:124-129`, `build.ts:154`, `routes/jobs.ts:44-60`) — a concurrent follow-up is REJECTED, not queued; (b) in-build message classifier `api/src/agents/guided-build.ts:34-49` classifyInBuildIntent (per-message dispatch, not steering); (c) notifications push (`streaming.ts:131-146`) after a run resolves. There is no in-flight steering queue on a LiveRunEntry. A side-question is necessarily a separate call, not steering of the live run.

# 5. Adding a new endpoint (contract conventions)
shared/src/ = zod schemas + inferred types + one endpoint descriptor map per domain (`docs/api-contract.md:6-14`). EndpointDescriptor: `{method,path,auth,request?,response?,query?,timeoutMs?,language?,kind?}` (`shared/src/descriptor.ts:24-35`). Error envelope CONV-2 (`shared/src/errors.ts:46-53`): `{error:{code:ErrorCode,message,details?}}` + fixed ERROR_STATUS (`errors.ts:56-76`); every non-2xx must validate against it.

To add an endpoint change: (1) the domain file in shared/src/ — request/response schemas + the descriptor entry in that domain's `…Endpoints` map; (2) `shared/src/index.ts` only for a NEW domain (ALL_ENDPOINTS `index.ts:72-100`); (3) a thin router in api/src/routes/ (validate via `parseBody`, call one module, shape response) mounted in `api/src/server.ts` (routes/index.ts is just `export {}`); (4) a contract test in api/tests/contract/. schema-coverage.test.ts fails if a new descriptor is neither covered nor pinned. Complete example: `shared/src/chat.ts:33-83` (schemas + chatEndpoints map) consumed by `api/src/routes/chat.ts`.

# 6. Session schema + per-session status
`shared/src/sessions.ts:18-29` Session (.passthrough()): id, name?, type?, artifactId?, messages?, createdAt, updatedAt. Server-side passthrough extras: messageCount (`persistence.ts:27`), lastContext (last <ekoa-context> block, re-injected next turn — `persistence.ts:40-42`, `context.ts:112-115`), and the guided-build phase `'idle'|'gathering'|'resolving-integrations'|'building'|'built'|'failed'` persisted on the session record (`guided-build.ts:14-15`). That build-phase union is the closest thing to a per-session status; there's no generic session-level busy/idle field — live run status lives per-run in registry.ts.

# 7. Docs constraints + affected diagrams
Tier table `docs/architecture.md:85-99`: data/config/shared tier 0; llm/, services/ tier 2; agents/, apps/, legal/ tier 5; routes/ tier 6. routes/ may not import data/; only llm/ may import @anthropic-ai/*. A side-question in agents/ called from a new routes/ handler fits the existing shape. Contract rule `docs/api-contract.md:8-14,138-153`: new endpoint = new descriptor + new contract test, CI-gated.
Diagrams (docs/diagrams/, updating same-PR is non-negotiable per FIXED-12) a side-question endpoint + parallel-session execution would touch: 04-agent-job (run/job lifecycle), 03-request-crud (chat/session flow), 06-llm-chokepoint-billing (new metered site + attribution tag), 10-privacy-boundaries (anonymising a call grounded in history+transcript); 05-data-model only if a new message kind/field or transcript store is added; 09-qa-pipeline only if test topology changes.

# 8. Tests
Contract: api/tests/contract/*.test.ts. Pattern (`api/tests/contract/gateway-keys.test.ts`): spin the REAL app via buildApp(cfg,deps) on in-memory Mongo, fetch with a real login token, assert `Schema.safeParse(body).success`, assert descriptor.auth/path, assert ErrorEnvelope on 401/400/404. Plus `shared/src/contract.test.ts` and `api/tests/contract/schema-coverage.test.ts` (coverage gate).
E2e (Playwright): `web/e2e/*.spec.ts` (`playwright.config.ts:11-12` testDir './web/e2e', testMatch '**/*.spec.ts'). Naming kebab-feature.spec.ts (chat-thinking.spec.ts, gateway-keys.spec.ts, legal-*.spec.ts). Second vision/drill layer: `tests/drills/*.spec.ts` + `drills/pages/*.yml`.

# Bottom line for the feature
- Call primitive already exists and is a one-liner: `completeFast(...)` (or runOneShot for a bigger model), attributed `answer-about-build`/`answer-about-ekoa` (pre-reserved, zero migration). Anonymisation/metering/rate-caps automatic through the chokepoint.
- Grounding in session history is free (reuse loadHistory / the messages store); a side-question message needs no parallel storage — ride metadata.kind or a new role, and filter it out of loadHistory if it shouldn't pollute future prompts.
- The real missing surface is the running-job transcript: not durably stored or readable, only a 200-event in-memory SSE ring with no getter. Grounding in a LIVE job's transcript requires tapping the in-process run signal or adding a per-run transcript buffer.
- No mid-run instruction queue exists — a side-question is a separate call, not live-run steering.

Key files: api/src/llm/{index,client,router,attribution}.ts, api/src/llm/anonymise/, api/src/agents/{chat,context,persistence,streaming,registry,jobs,guided-build}.ts, api/src/events/sse-manager.ts, shared/src/{sessions,chat,jobs,events,errors,descriptor,index}.ts, api/src/config.ts:103-111, docs/{architecture,api-contract}.md, docs/diagrams/.
