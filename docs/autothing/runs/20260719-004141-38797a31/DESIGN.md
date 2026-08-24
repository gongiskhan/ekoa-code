# Implementation design: parallel sessions + grounded side-questions

Verified the three reports against the code (registry.ts, build.ts, jobs.ts, routes/jobs.ts, streaming.ts, chat.ts, context.ts, config.ts, shared/{jobs,events,chat,errors}.ts, useAutomationRun.ts, suite ledger, ekoa-testing + ekoa-architecture skills). All seven of your decisions hold. Five concrete adjustments, each with a reason:

## Adjustments to the provisional decisions

1. (D2) sweepOrphans kills boot re-dispatch as specified: it fails EVERY non-terminal job at boot (api/src/agents/jobs.ts:128-167), which includes 'queued'. The sweep must skip status 'queued' in the jobs loop, and server.ts calls a new redispatchQueuedBuilds() AFTER the sweep.

2. (D2) Boot re-dispatch needs input reconstruction: executeBuildJob needs BuildCreateInput (actor{userId,orgId,role}, username, attachments, knowledgeDocs), but the persisted request omits attachments + knowledgeDocs (build.ts:129-137) and there is no actor/username on the record. Design: persist attachments + knowledgeDocs into record.request ONLY when the job is created queued (JobRecord.request already declares attachments; knowledgeDocs is bounded at 20 x 256KiB, acceptable per-doc); at boot, rebuild actor/username from the users store; user missing -> patchJob failed{ORPHANED}.

3. (D2) Cap accounting must be commitment-based or it races: handleBuildCreate has awaits (persistJob, classifier) between any count-check and dispatch, so two creates for one user can interleave at microtask boundaries and both pass the cap. Fix: LiveRunEntry gains state: 'registered'|'queued'|'executing'; the queue decision AND the state assignment happen in one synchronous block (zero awaits between count and commit); liveBuildCountForUser counts state==='executing' only, kind==='build' only (brand-research excluded), ownerUserId match. Clamp the cap to >=1 (envInt accepts 0, which would queue forever).

4. (D2) No new SSE event type for queued->running. Job.status is z.string() on the wire (shared/src/jobs.ts:10), so 'queued' rides the existing contract; the client flips a session to running on the FIRST execution JobEvent (routing/artifact/plan_step/text_chunk/tool_event) and terminal events do the rest. Adding a union member costs the protocol-parity gate + all four subscriptions for zero information: the 202 body and GET /jobs/:id already carry the status.

5. (D6) integration_ready has NO server emitter today: grep over api/src finds zero hits; only shared/src/events.ts:189 + the web consumers exist. So the "root fix" is: add optional sessionId to the shared schema (additive) + make the chat-runtime handler use event.sessionId when present (dropping the activeSessionId assumption) + check how the parity fixture pins a never-emitted event. No api file changes.

Also one proof-gate correction: "build result byte-identical with vs without side question" is untestable - two LLM runs are never byte-identical. Replace with structural non-interference on ONE build: (a) side-question text appears nowhere in the build's prompt/SDK transcript, (b) the side-question call goes through completeFast with its own attribution (tool-less by type, read-only by construction), (c) the build completes normally. That is the actual guarantee the gate wants.

## A. Slices

Groups are sequential; slices inside a group own disjoint files and run in parallel.

### G1 - S1: per-user build cap + queued dispatch (server) [mixed]
Files: api/src/config.ts, api/src/agents/registry.ts, api/src/agents/build.ts, api/src/agents/jobs.ts, api/src/server.ts, shared/src/jobs.ts (comment documenting the 'queued' status value only), api/tests/contract/jobs-queue.test.ts (new), api unit test file for the dispatch protocol (new), api/tests/SUITE_LEDGER.json.
Acceptance:
- MAX_CONCURRENT_BUILDS_PER_USER in loadAgentsConfig (default 2, clamped >=1).
- 3rd concurrent build for one user -> 202 {status:'created', job.status:'queued'}, persisted 'queued', no execution starts.
- Terminal transition of a running build auto-dispatches that user's oldest queued job (FIFO by createdAt); it flips to running and streams normally.
- Cancel of a queued job -> {cancelled:true}, record 'cancelled', never dispatched.
- Per-artifact 409 preserved: a queued follow-up on artifact X blocks another follow-up on X; first-build session reservation still binds a duplicate POST to the queued job.
- Restart with a queued job: sweep leaves it, re-dispatch runs it (contract test via the mechanics seam, LLM-free).
- Different users never share slots.
Docs/diagrams: 04-agent-job (queued state, dispatch loop, boot re-dispatch), 05-data-model ('queued' + request persisted-when-queued), operations-runbook (env var + rate-cap interplay note), decisions.md (queue-over-reject, cap default 2).

### G1 - S4: web job-stream manager + per-session ingestion [ui]
Files: web/lib/job-stream-manager.ts (new), web/hooks/useJobStream.ts (deleted, logic absorbed), web/hooks/useAgentExecution.ts, web/stores/orchestration.ts (add selectors + sessionChatRuns map; keep writing global isExecuting for compat until S5), web/components/providers/api-provider.tsx (rehydrate call), web unit tests, web/e2e/parallel-sessions.spec.ts (new), SUITE_LEDGER (band4_gap_plan + needsWeb).
Acceptance:
- One EventSource per RUNNING/QUEUED job regardless of focus; events written to the OWNING session's store buckets; the activeSessionId fallback in addOutputToStore (useJobStream.ts:152-153) is gone.
- Switch away/back mid-stream loses nothing; refresh mid-two-runs rehydrates both sessions (GET /jobs/:id per tracked job) and reattaches live streams.
- e2e: schema-validated SSE stubs with CORS headers, real UI login, zero console errors, two sessions streaming simultaneously.
Docs/diagrams: 04-agent-job (client multiplex ingestion path).

### G2 - S2: one live chat run per session, 409 (server) [mixed]
Files: api/src/agents/registry.ts (hasLiveChatRunForSession), api/src/agents/chat.ts, api/src/routes/chat.ts, shared/src/errors.ts (DUPLICATE_CHAT_RUN -> 409 in ErrorCode + ERROR_STATUS), api/tests/contract/chat-run-conflict.test.ts (new), ledger.
Acceptance: second POST /chat/runs for the same session while the first is unsettled -> 409 envelope, code DUPLICATE_CHAT_RUN, validates against ErrorEnvelope; different sessions -> both 202; after settle (complete/error/cancel) a new run is accepted; a THROWN executeChatRun still frees the guard (unit test - the guard predicate is entry.status===undefined on lingering chat entries, and settle is verified on every exit path including the catch-all at chat.ts:279).
Docs/diagrams: 03-request-crud (guard), api-contract.md error table.

### G2 - S5: per-session chat control plane; kill global isExecuting [ui]
Files: web/components/chat/chat-runtime.tsx, web/components/builder/chat-panel.tsx, web/components/builder/output-panel.tsx, web/app/(dashboard)/chat/[[...sessionId]]/page.tsx, web/components/chat/global-chat-dock.tsx, web/stores/orchestration.ts (remove isExecuting), shared/src/events.ts (integration_ready optional sessionId + parity fixture), web unit tests, ledger. Disjoint from S2 (S2 owns shared/errors.ts; S5 owns shared/events.ts).
Acceptance:
- Chat turn completes in session A while a build streams in B; Stop in A never affects B.
- The five singleton refs (chatTraceIdRef, chatStreamCleanupRef, cancelledTracesRef, buildIntentHandledRef, executingSessionRef) become one Map keyed by sessionId; queue flush is per-session and fires on THAT session's completion even when unfocused.
- Send guard derives from per-session state (sessionJobs status + sessionChatRuns), not a global flag; 409 on chat POST -> local enqueue keyed by HTTP status (no dependency on S2's symbol, so the slices stay parallel).
- build_intent/chat_answer/integration_ready route by event.sessionId; grep finds no reader of the removed global isExecuting.
Docs/diagrams: 04-agent-job note if review deems the control-plane change structural; otherwise none.

### G3 - S3: run-transcript accumulator + side-question endpoint (server) [mixed]
Files: api/src/agents/run-transcript.ts (new), api/src/agents/streaming.ts (JobStreamSink optional tap), api/src/agents/registry.ts (entry.transcript field), api/src/agents/build.ts (wire accumulator into executeBuildJob), api/src/agents/side-question.ts (new), api/src/agents/context.ts (loadHistory skips metadata.kind==='side-question', mirroring the providerError filter at context.ts:50), api/src/agents/persistence.ts (optional metadata param on persistUserMessage), api/src/routes/chat.ts (mount), shared/src/chat.ts (schemas + descriptor), api/tests/contract/side-question.test.ts, unit tests (caps, filter), ledger. Needs S1 (build.ts/registry.ts) and S2 (routes/chat.ts) landed.
Acceptance: below in B3, plus: contract test validates 200 against SideQuestionResponse, 401/400/404 against the envelope, asserts both messages persisted with metadata.kind='side-question', and asserts a subsequent loadHistory excludes them; schema-coverage gate updated same PR.
Docs/diagrams: 06-llm-chokepoint-billing (answer-about-build call site), 10-privacy-boundaries (accumulator holds only wire-safe already-redacted content, in-memory, dies with the run), 03-request-crud (endpoint), 05-data-model (message metadata.kind + history exclusion), api-contract.md.

### G3 - S6: multi-session awareness UX, PT-PT [ui]
Files: web/components/builder/sessions-panel.tsx, web/components/chat/mobile-sessions-drawer.tsx, web/components/chat/global-chat-dock.tsx (S5 landed, so no conflict), web/lib/job-stream-manager.ts (terminal handler -> toast when owning session !== active), web/locales/pt.ts, web/locales/en.ts, web/locales/types.ts, web/e2e/session-status-badges.spec.ts (new, band4 needsWeb), ledger.
Acceptance: session cards + drawer + dock switcher show a live badge from sessionJobs[id].status (Em fila / Em execucao / Concluido / Falhou) without opening the session; background completion/failure raises a toast (existing toast store, action jumps via setActiveSession); ALL copy through locale tables (no new inline ternaries); cap-exceeded queue state visible in PT-PT (e2e asserts the copy).
Docs/diagrams: none structural; locales only.

### G4 - S7: side-question UI ("btw" thread) [ui]
Files: web/components/builder/chat-panel.tsx (composer affordance + MessageBubble branch on metadata.kind==='side-question'), web/components/chat/chat-runtime.tsx (side-question send path), the typed api client module in web/lib/api/, web/locales/{pt,en,types}.ts, web/e2e/side-question.spec.ts (new, band4 needsWeb), ledger. Needs S3 (contract) + S5/S6 (file ownership).
Acceptance: while the session is busy, the composer offers a side-question mode visually distinct from a follow-up instruction (the brief's UX split); the answer renders as a distinct foldable thread, never as a normal assistant message; asking never touches the running job's stream/state; PT-PT via tables; stubbed e2e validates request/response against the shared schemas; zero console errors.
Docs/diagrams: 03-request-crud annotation.

### G5 - S8: live proof journey + coherence pass [mixed]
Files: api/tests/journeys/parallel-sessions-probe.mjs (new), SUITE_LEDGER journeys section, docs/testing.md registration, docs/findings.md for anything discovered, final diagram cross-check.
Acceptance = the brief's proof gates on the live stack (build api, restart driver, re-provision credential per ekoa-testing): two real builds in two sessions to completion with zero cross-contamination of files/preview/output; chat in A during build in B; side question mid-build whose answer cites actual build activity (assert it references a real file/tool from the accumulator); the non-interference assertions from the corrected gate; refresh rehydration; third build shows queue behavior in PT-PT.

## B. Tricky mechanics

### B1. Queued dispatch lifecycle
Commit protocol at the end of handleFirstBuild/handleFollowUp (after reservation/artifact-guard/classifier, so a follow-up classified 'question' is still answered immediately and never queued):

  // one synchronous block - no await between count and commit:
  const cap = Math.max(1, cfg.maxConcurrentBuildsPerUser);
  const queued = liveBuildCountForUser(userId) >= cap;   // counts state==='executing'
  entry.state = queued ? 'queued' : 'executing';
  // then:
  record.status = queued ? 'queued' : 'created';
  await persistJob(record);                               // catch: removeRun + rethrow (no slot leak)
  if (queued) {
    entry.dispatch = () => void executeBuildJob(jobId, input, abort, opts);  // sync, post-persist
    if (abort.signal.aborted) finalizeQueuedCancel(jobId) // cancel landed during the persist await
    else abort.signal.addEventListener('abort', () => finalizeQueuedCancel(jobId), { once: true });
    tryDispatchUser(userId);                              // closes the slot-freed-during-persist window
  }
  return { ..., fire: queued ? () => {} : () => void executeBuildJob(...) };

tryDispatchUser(userId): while executing-count < cap, pick the oldest registry entry {kind:'build', state==='queued', !finalized, dispatch set, ownerUserId===userId}; synchronously remove the abort listener, set state='executing', take + clear the dispatch thunk, invoke it. Each iteration is synchronous, so concurrent callers cannot double-dispatch. Entries with state 'queued' but no dispatch thunk yet (mid-persist) are skipped - their own enqueue path self-checks after persist (line above).
Call sites: (1) executeBuildJob's finally, right after removeRun(jobId) - the ONE funnel every terminal path passes (complete, all error codes, cancel, timeout, PIPELINE_STUCK zombie net), which beats hooking individual finalizeOnce sites; (2) the enqueue self-check; (3) boot.
finalizeQueuedCancel: if (!finalizeOnce(jobId)) return; patchJob {status:'cancelled', endedAt}; releaseReservation(sessionId, jobId) for first builds; removeRun(jobId). No SSE emit - consistent with cancel of a running build (bail() at build.ts:670-676 patches without a terminal event); the cancelling client gets {cancelled:true} and rehydration covers other tabs.
409 vs queue: hasLiveJobForArtifact keys on !finalized regardless of state, and persisted 'queued' is non-terminal for nonTerminalJobForArtifact - so queued follow-ups keep blocking same-artifact POSTs, and the first-build reservation precedes the cap check. Parallelism stays strictly cross-session.
Boot: after the (modified) sweep, redispatchQueuedBuilds(): load status==='queued' jobs, group per user, order by createdAt; per job rebuild input from record.request + users-store lookup (actor, username), new AbortController, registerRun with state 'queued' + dispatch thunk, re-reserve the first-build reservation when the record has no artifactId (a queued first build never got one - artifactId is only patched in after running starts, build.ts:324 - so record.artifactId presence exactly distinguishes follow-up from first build); then tryDispatchUser per user.
Client mapping: SessionJobState 'queued' (already in the union, orchestration.ts:77-100) is set from the 202 body and from rehydration; flips to 'running' on the first execution event via the manager; no SSE union change.

### B2. Web stream-manager module
web/lib/job-stream-manager.ts, module-level like useAutomationRun's runEntries (useAutomationRun.ts:177-271) but liveness-owned instead of mount-ref-counted - deliberate divergence, justified: background sessions have no mounted component to hold a ref, and the job's liveness IS the ownership.
API:
- trackJob(jobId, sessionId): idempotent; opens the existing openJobStream factory (stream.ts already supports N concurrent EventSources); binds handlers that ALWAYS write to store buckets keyed by this sessionId; closes + deletes itself on complete/error; on 2nd+ ready re-syncs via GET /jobs/:id (mirrors useAutomationRun/FC-026).
- untrackJob(jobId): explicit stop/cancel path.
- rehydrateJobs(): for every sessionId in store.sessionJobs with status running|queued and a jobId: GET /jobs/:id, write terminal state or trackJob. Called once from api-provider on auth-ready (replaces the per-session scatter in initializeBuilderSession/useAgentExecution mount effects as the stream-owning path; those keep their non-stream duties).
What moves where: the event handlers inside useJobStream (artifact/plan_step/preview_reload/complete/error/text) become pure (sessionId, event) -> store writers inside the manager; useJobStream.ts is deleted; useAgentExecution keeps job start/cancel + calls trackJob on the 202 (also for queued jobs - the stream opens and sits silent until dispatch, so the queued->running transition is never missed); its jobIdRef/previewStartedRef become per-session store state. Store additions (S4): sessionChatRuns: Record<sessionId,{runId,startedAt}> and derived selectors (sessionBusy(id) = sessionJobs[id].status in {running,queued} || sessionChatRuns[id] present); global isExecuting removed in S5 along with the chat-runtime singleton refs -> Map keyed by sessionId.

### B3. Side-question schemas + accumulator
shared/src/chat.ts:
- SideQuestionRequest = { sessionId: string, question: string (1..4000), language: 'pt'|'en' default 'pt' }
- SideQuestionResponse = { answer: string, jobId?: string }
- chatEndpoints.sideQuestion = { method:'POST', path:'/api/v1/chat/side-questions', auth:'user', request, response, timeoutMs: 60000, language: true }. Synchronous 200 - completeFast is fast-tier; no SSE, no registry entry, no run id.
Handler (agents/side-question.ts): session ownership check (404 on miss/foreign, matching the oracle-collapse convention); checkAllowance (billing envelope on refusal); locate the live build by registry scan {kind:'build', ownerUserId, sessionId, !finalized}, newest if several; history = loadHistory(sessionId) (post-filter, so side-questions never self-pollute); prompt = history + accumulator snapshot + question; completeFast({messages, system, maxTokens:1024, signal: 30s}, {kind:'user_work', agentType:'answer-about-build', billeeUserId, sessionId, runId: jobId}) - the pre-reserved attribution tag (attribution.ts:31), FAST-only by type, tool-less by type, anonymisation automatic via the session vault since sessionId is passed. Persist question (role user) + answer (role assistant) with metadata {kind:'side-question', jobId?}; return {answer, jobId?}. No live build -> answer from history alone (covers side questions during a chat turn; chat-transcript tapping is an explicit v1 non-goal, history-only).
Accumulator (agents/run-transcript.ts): class RunTranscript { note(ev: JobEvent); snapshot(): string } holding textTail (last 16 KiB of text_chunks), tools (ring of last 50 {phase, tool, argsPreview, isError, durationMs}), files (Set<=200, derived from Write/Edit-class tool args file_path), planSteps (last 20). Total bounded ~<64 KiB per run, constants in the module. Fed via an optional tap constructor arg on JobStreamSink - the sink already holds marker-filtered, engine-redacted, truncated wire payloads, so the accumulator can never contain anything the user's own SSE stream did not (the 10-privacy-boundaries argument). thinking_chunks excluded (commentary noise). Created in executeBuildJob, attached as entry.transcript, freed by removeRun. NOT the SSE ring, NOT persisted - per your D4.

## C. Races and what needs a test

1. Over-cap admission race (two creates interleaving at awaits) - closed by the synchronous commit protocol. Unit test: two interleaved creates at cap 1 -> exactly one executing, one queued.
2. Dispatch racing cancel-of-queued - both are synchronous blocks over the same entry; whichever runs first wins, the other no-ops via finalizeOnce / the stripped listener. Unit test both orders.
3. persistJob failure after commitment would leak an 'executing' slot forever - the catch does removeRun + rethrow (route 500s). Unit test.
4. Two same-user builds finishing simultaneously - two finally blocks call tryDispatchUser; the sync while-loop + executing-count makes double-dispatch impossible. Unit test: 2 running + 2 queued, finish both -> both queued dispatch exactly once.
5. Terminal double-fire - already covered by finalizeOnce (registry.ts:116-121); the dispatch hook rides the finally, which runs once per run.
6. Boot: sweep-then-redispatch ordering; queued job whose user vanished -> ORPHANED. Contract test.
7. checkAllowance is read-only (no reservation), so two dispatches can both pass with budget for one - pre-existing by design (allowance.ts:5-6), NOT worsened (the gate already sits at dispatch); note on 06-diagram, no code change.
8. In-memory per-user rate caps (rate-caps.ts): two parallel builds share the 60s window -> transient LlmRateCapError/ADAPTER_ERROR bursts possible mid-job. Accepted at cap 2; operator note in the runbook for anyone raising the cap.
9. Notifications-ring routing: S5 removes the activeSessionId fallbacks (chat_answer/integration_build_intent at chat-runtime 374/403, integration_ready at 429). Web unit test: events for a background session land on that session.
10. Browser connection ceiling: N job EventSources + notifications + chat on HTTP/1.1 is ~6/origin. Fine at cap 2; runbook note (HTTP/2 at the proxy lifts it).
11. Store persist sanitizes running/queued -> idle (orchestration.ts:1581) - kept; rehydrateJobs() re-derives truth from the server. Covered by the refresh e2e.
12. Accumulator memory: bounded ~64 KiB x live builds, freed on removeRun; chat entries linger by design but carry no accumulator in v1.

## D. Test plan summary

- Contract (api/tests/contract, in-memory Mongo, LLM-free via the mechanics seam + stubbed provider): jobs-queue.test.ts (queued 202 parses Job; FIFO dispatch; cancel-queued; boot redispatch; artifact-409 preserved), chat-run-conflict.test.ts (409 envelope + new code in ERROR_STATUS), side-question.test.ts (schema, auth, envelope, persistence metadata, loadHistory exclusion); schema-coverage + protocol-parity gates updated in the same PRs.
- Unit (api vitest): dispatch protocol races 1-4 + 6, accumulator caps, loadHistory filter, sweep-skips-queued. Web vitest: manager per-session routing, busy selectors, per-session chat refs, background-terminal toast.
- Playwright e2e: all three new specs (parallel-sessions, session-status-badges incl. PT-PT queue copy, side-question) in band4_gap_plan with needsWeb:true - they run under EKOA_E2E_WEB=1 / npm run e2e:full, skip reasoned otherwise; registered in SUITE_LEDGER in the same change (census + ratchet); schema-validated stubs only, WITH CORS headers; real UI login; zero console errors on dashboard pages.
- Live proof (S8): api/tests/journeys/parallel-sessions-probe.mjs against the real stack (rebuild api, restart run-ekoa-code driver, re-provision credential) covering every brief proof gate with the byte-identical gate replaced by the structural non-interference assertions.

Lean check: no queue framework, no workers, no scheduler abstraction - the whole queue is one entry-state field, one FIFO scan over the existing runs Map, one dispatch function called from the existing terminal funnel, and one boot pass.

### Critical Files for Implementation
- /Users/ggomes/dev/ekoa-code/api/src/agents/build.ts
- /Users/ggomes/dev/ekoa-code/api/src/agents/registry.ts
- /Users/ggomes/dev/ekoa-code/web/lib/job-stream-manager.ts (new; absorbs web/hooks/useJobStream.ts)
- /Users/ggomes/dev/ekoa-code/web/components/chat/chat-runtime.tsx
- /Users/ggomes/dev/ekoa-code/shared/src/chat.ts
