# Flow Plan - Session Parallelism + Grounded Side-Questions

Run `20260719-004141-38797a31`. Brief: `BRIEF.md` (same dir). Full mechanics + race analysis: `DESIGN.md` (same dir) - binding for implementers; read your slice's section before coding.

## Corrected assumptions (verified against code; the brief was wrong about these)

- There is NO server-side `queued` status and NO per-user concurrency guard of any kind. Statuses: created/running/completed/failed/cancelled. The cap + FIFO queue is new work.
- SSE is per-JOB streams (`/jobs/:id/events`) + one per-user notifications stream - not one per-user stream with trace filtering. The web transport already supports N EventSources; the single-stream constraint lives in the hooks.
- Chat has NO in-flight guard, server or client (client queues on the global `isExecuting` flag only).
- No server-side follow-up instruction queue exists; only the client per-session `queuedMessages` with a single-session flush driver.
- No readable job transcript exists (only the 200-event SSE reconnect ring, no getter). The side-question accumulator is new work.
- `completeFast()` + pre-reserved attribution tag `answer-about-build` are the side-question primitives; anonymisation/metering automatic via the chokepoint (pass sessionId to share the session vault).
- Previews cannot collide across artifacts (in-process serving, no ports). Billing CAS + per-job timers compose safely. `checkAllowance` is read-only pre-run admission (two concurrent dispatches can both pass) - pre-existing by design, not worsened; documented, not changed.

## Slices

| # | Slice ID | Title | Kind | Routes to (area skill) | Parallel group | Status |
|---|----------|-------|------|------------------------|----------------|--------|
| 1 | s1-build-queue | Per-user build cap + queued FIFO dispatch (server) | mixed | ekoa-architecture, ekoa-testing | G1 | in_progress |
| 2 | s4-web-stream-manager | Multi-job stream manager + per-session ingestion (web) | ui | ekoa-architecture, ekoa-testing | G1 | in_progress |
| 3 | s2-chat-run-guard | One live chat run per session, 409 (server) | mixed | ekoa-architecture, ekoa-testing | G2 (after G1) | pending |
| 4 | s5-web-session-control | Per-session chat control plane; kill global isExecuting (web) | ui | ekoa-architecture, ekoa-testing | G2 (after G1) | pending |
| 5 | s3-side-question-api | Run-transcript accumulator + side-question endpoint (server) | mixed | ekoa-architecture, ekoa-testing | G3 (after G2) | pending |
| 6 | s6-awareness-ux | Session-list live badges + background-completion toasts, PT-PT (web) | ui | ekoa-architecture, ekoa-testing | G3 (after G2) | pending |
| 7 | s7-side-question-ui | Side-question "btw" thread UI, PT-PT (web) | ui | ekoa-architecture, ekoa-testing | G4 (after G3) | pending |
| 8 | s8-live-proof | Live proof journey + coherence pass | mixed | ekoa-testing | G5 (after G4) | pending |

Slices inside a group own DISJOINT files (verified in DESIGN.md section A; S2 owns `shared/errors.ts`, S5 owns `shared/events.ts`). Groups are sequential.

## Acceptance per slice (concise - full criteria in DESIGN.md §A)

- **s1-build-queue**: `MAX_CONCURRENT_BUILDS_PER_USER` in `loadAgentsConfig` (default 2, clamp >=1). 3rd concurrent build for one user -> 202 with `job.status:'queued'`, persisted, not executed. Terminal transition of a running build FIFO-dispatches that user's oldest queued job (hook in `executeBuildJob`'s finally, after `removeRun`). Cancel-of-queued works, never dispatched. Per-artifact 409 + first-build reservation preserved. Restart: sweep skips `queued`, `redispatchQueuedBuilds()` re-runs them (input persisted at queue time; user vanished -> ORPHANED). Commitment-based cap accounting - zero awaits between count and state commit (DESIGN.md §B1 protocol verbatim). Diagrams 04, 05 + runbook + decisions.md.
- **s4-web-stream-manager**: new `web/lib/job-stream-manager.ts` (liveness-owned, modeled on `useAutomationRun`'s runEntries); one EventSource per RUNNING/QUEUED job regardless of focus; events write to the OWNING session's store buckets; `useJobStream.ts` deleted; activeSessionId fallback misattribution gone; `rehydrateJobs()` on auth-ready; refresh mid-two-runs rehydrates both and reattaches. e2e `parallel-sessions.spec.ts` (band4, needsWeb, schema-validated stubs + CORS, real login, zero console errors). Diagram 04.
- **s2-chat-run-guard**: second POST `/chat/runs` for a session while one is unsettled -> 409 envelope, new code `DUPLICATE_CHAT_RUN` in ErrorCode + ERROR_STATUS; different sessions both 202; guard freed on every exit path incl. thrown executeChatRun. Contract test. Diagram 03 + api-contract error table.
- **s5-web-session-control**: the five chat-runtime singleton refs become Maps keyed by sessionId; queue flush per-session, fires on THAT session's completion unfocused; send guard derives from per-session state (`sessionJobs` + new `sessionChatRuns`); global `isExecuting` removed (grep-clean); `integration_ready` gains optional sessionId in `shared/events.ts` (additive; no server emitter exists) and all notification handlers route by event.sessionId; 409 on chat POST -> local enqueue by HTTP status. Chat in A completes while build streams in B; Stop in A never touches B.
- **s3-side-question-api**: `RunTranscript` accumulator (textTail 16KiB, last 50 tool events, files set <=200, plan steps 20; ~64KiB cap; fed via optional JobStreamSink tap - only wire-safe already-redacted content; freed on removeRun). `POST /api/v1/chat/side-questions` (schemas + descriptor in `shared/chat.ts`, synchronous 200, timeoutMs 60000): ownership 404, allowance gate, grounding = loadHistory + accumulator snapshot of the session's live build (if any), `completeFast` with `{kind:'user_work', agentType:'answer-about-build', billeeUserId, sessionId, runId}`; Q+A persisted with `metadata.kind:'side-question'`; `loadHistory` filters that kind out (mirrors providerError filter). Contract test + schema-coverage same PR. Diagrams 03, 05, 06, 10 + api-contract.md.
- **s6-awareness-ux**: session cards + mobile drawer + dock switcher show live badge from `sessionJobs[id].status` (PT-PT: Em fila / Em execução / Concluído / Falhou); background completion/failure -> toast with jump action (existing toast store + setActiveSession); ALL copy via locale tables (pt/en/types - no new inline ternaries); e2e `session-status-badges.spec.ts` asserts the PT-PT queue copy.
- **s7-side-question-ui**: while a session is busy the composer offers a side-question mode visually distinct from a follow-up instruction; answer renders as a foldable distinct thread (MessageBubble branch on `metadata.kind`), never a normal assistant message; asking never touches the running job's stream/state; typed client from the descriptor; PT-PT; e2e `side-question.spec.ts` with schema-validated stubs; zero console errors.
- **s8-live-proof**: `api/tests/journeys/parallel-sessions-probe.mjs` against the live stack: two real builds in two sessions to completion, zero cross-contamination (files/preview/output); chat in A during build in B; side question mid-build whose answer cites a real file/tool from the accumulator; structural non-interference (side-question text absent from the build's SDK transcript; call went through completeFast attribution) - replaces the untestable byte-identical gate; refresh rehydration; 3rd build queues with PT-PT copy. Ledger journeys section + testing.md + findings.md for anything discovered; final diagram cross-check.

## Parallelism

G1: s1-build-queue (api/*) ∥ s4-web-stream-manager (web/*) - disjoint. G2: s2 (api + shared/errors.ts) ∥ s5 (web + shared/events.ts) - disjoint. G3: s3 (api + shared/chat.ts) ∥ s6 (web locales/components) - disjoint. G4: s7 alone. G5: s8 alone. Serialize the shared runtime: one dev stack, one e2e:full run, one walkthrough recorder at a time.

## Global acceptance

`evidence-index.json -> globalGate` (this dir). Every slice: committed re-runnable tests green (`npm run ci:lane` + registered e2e), same-model review, fresh-context adversarial review approve, independent adversarial test pass, design audit (ui slices), verified walkthrough video. Non-goals binding: no external queue infra, no intra-session parallelism, no SDK resume/transcript change, no side-question filesystem access. Contract discipline: new endpoint/descriptor/error-code changes carry contract tests + schema-coverage updates same PR; suite-ledger census updated with every new spec; diagrams updated in the same unit of work (FIXED-12).
