# Frontend job-event path — trace and single-active-stream audit

No `.codegraph/` exists; this is from direct reads of `web/` + `shared/src/events.ts`. The whole live-run architecture funnels through ONE shell-mounted controller (`ChatRuntimeProvider`) owning ONE build-execution hook bound to the ACTIVE session, ONE job SSE stream, and a GLOBAL `isExecuting` boolean. Per-session DATA exists in the store; the CONTROL PLANE (execution hook, streams, the flag, chat-run refs) is singular.

## 1. Orchestration store — state shape + global isExecuting
`/Users/ggomes/dev/ekoa-code/web/stores/orchestration.ts`
- Per-session maps (keyed by sessionId): `messages`(191), `sessionJobs`(194), `sessionPreviews`(197), `sessionFiles`(200), `sessionSidePanelStates`(206), `activeIntegrationBuilds`(211), `activityMessages`(214), `retryContexts`(217), `streamingChat`(220), `streamingThinking`(225), `queuedMessages`(229), `composerDraft`(234).
- Global single-value: `activeSessionId`(188), `isExecuting`(208), `sidePanelState`(204), `sidePanelTab`(207), `pendingAttachments`(237), `pendingDelegation`(240).
- `SessionJobState`(77-100) fully models per-session `status: idle|queued|running|completed|failed|cancelled` + phase/progress/output — so per-session run truth lives at `sessionJobs[X].status`, but nothing surfaces it.
- Setter (981). `setActiveSession` FORCE-RESETS `isExecuting:false` on every switch (678-683) — the flag tracks the active session only. `initializeBuilderSession` also hard-resets it (1168). Persist sanitizes running/queued→idle (1581).

## 2. useJobStream — the single job SSE hook
`/Users/ggomes/dev/ekoa-code/web/hooks/useJobStream.ts`
- `useJobStream(jobId, sessionId?)` (106) — one job, one session. NO client-side trace filtering; stream is server-scoped (246-248).
- Bound to active session, TORN DOWN on session switch (`disconnect()` in the sessionId-change effect 707-730) + unmount (677-683). Backgrounded builds stop getting live events; recovery is status-only (see §4).
- `addOutputToStore` falls back to store.activeSessionId (152-153) → output can be MISATTRIBUTED to the wrong session.
- Handlers write into `sessionJobs[sessionId]`: `artifact`(427), `preview_reload`(449), `plan_step`(374), `complete`(468), `error`(547).

## 3. SSE client — EventSource, per-stream
`/Users/ggomes/dev/ekoa-code/web/lib/api/stream.ts`
- Native `EventSource` (147, only instance). URL `…?token=<token>` (146). Named events dispatched by type (221-232).
- Reconnect: native keeps Last-Event-ID; hard CLOSED → backoff 500ms×1.5^n cap 15s (153-180). `activeStreams` set + token/resilience listeners (38-65).
- Four scoped factories (242-261): chat-run/job/automation/notifications. Each opens its OWN EventSource — the TRANSPORT already supports N concurrent streams. Scoping is by URL (one stream per id), NOT trace_id.

## 4. Rehydration (papers over missed events)
- `useAgentExecution` mount effect (`hooks/useAgentExecution.ts` 359-391): if session job running/queued → GET /jobs/:id, reconnect or write terminal status. This restores a build on navigating back.
- `useJobStream` 2nd-ready re-sync (255-267). `initializeBuilderSession` (orchestration 1263-1291) GET /jobs/:id per session on shell mount; artifact-list rehydrate (1209-1261). `complete` reloads real file tree (521). Net: events dropped during a switch window are recovered as terminal status + file refetch, NOT a faithful replay.

## 5. Session-list UI — NO live status today
`/Users/ggomes/dev/ekoa-code/web/components/builder/sessions-panel.tsx` cards (216-324) show only: active-teal-dot (232-234), messageCount (283-285), updatedAt (287-289). No read of `sessionJobs[id].status`. Per-session badge goes in the card header ~252-259, reading `sessionJobs[session.id]?.status`. Same gap in `mobile-sessions-drawer.tsx` and the dock switcher (`global-chat-dock.tsx` 123-135). `sidebar.tsx` shows nothing.

## 6. Notifications/toasts
- Toast store `/Users/ggomes/dev/ekoa-code/web/stores/toast.ts` — `toast.success/error/info(msg, {action:{label,onClick}, duration})`, callable anywhere (46-63); rendered by `components/ui/toaster.tsx`. Ready-made for "build finished in another session". NOT currently wired to run completion.
- Server push: `NotificationEvent` stream opened once in `components/providers/api-provider.tsx` (66-93), per-user (every tab).

## 7. Chat send + in-flight guard
`sendMessage` in `chat-runtime.tsx` (754-827). Guard is GLOBAL (762-767): while `isExecuting`, message is QUEUED not sent. Composer isn't hard-disabled — `chat-panel.tsx` keeps textarea live, shows queue+Stop (574-604); empty-state composer swaps Send→Stop (chat page 811-829). Chat path also guards `if(!text||isExecuting)return` (471).

## 8. Queued follow-up + notification handlers
- Queue flush (`chat-runtime.tsx` 833-847) uses a SINGLE `executingSessionRef` and only flushes if still on that session — single-executing-session assumption. Queue store is per-session; the driver is not.
- `build_intent`(321-365): origin-filtered on the SINGLE `chatTraceIdRef.current` (331) + single `buildIntentHandledRef`(320). `chat_answer`(371-395): `event.sessionId||activeSessionId`(374), drops Stopped runs via single `cancelledTracesRef`(133). `integration_build_intent`(400): `sessionId||activeSessionId`(403). `integration_ready`(426-458): **activeSessionId ONLY (429)** — event has no sessionId (`shared/src/events.ts` 189), so lands on the WRONG session if navigated away.

## 9. Message thread rendering / typing
`chat-panel.tsx`: renders `messages[sessionId]` filtered to isEssential (246-250) via `MessageBubble`(617). NOT a discriminated union — `ChatMessage` (orchestration 21-50) informally keyed by `role` + `metadata.type` (text|tool_use|status|error|result|skill|activity|…). Bubble switches on role (646) then metadata.type (699-703). Live stream is `StreamingChatSection` (1076-1104). For a distinct side-question thread: add a new `metadata.type` and a `MessageBubble` branch — the switch is already there.

## 10. i18n
Two coexisting systems: (a) formal `useI18nStore` (default 'pt', persisted `ekoa_language`) + `useTranslation()` + `web/locales/{pt,en}.ts` (~1615 lines each) typed by `types.ts`; non-React via `web/lib/i18n.ts`. (b) ~24 inline `language==='pt'?…:…` ternaries, concentrated in `chat-runtime.tsx` (345,414,444,619,636,721,773) and `useAgentExecution.ts` (231,319). New copy should go through the locale tables, not inline ternaries.

## 11. Everything that breaks with two concurrent running jobs
Root-cause singletons: (1) global `isExecuting` reset on switch (orchestration 208/680); (2) single `useAgentExecution(activeSessionId)` (chat-runtime 120), internal `jobIdRef`/`previewStartedRef` (68-69); (3) `useJobStream` one stream, torn down on switch, activeSessionId misattribution; (4) single chat-run refs `chatStreamCleanupRef`/`chatTraceIdRef`/`cancelledTracesRef`/`buildIntentHandledRef` (125/128/133/320) — a 2nd chat run overwrites them, breaking Stop + the build_intent origin filter; (5) single `executingSessionRef` (833).
UI misbehaving (global flag + active-session content): (6) ChatPanel spinner/timer/stream gate on global flag (205,413-456); (7) OutputPanel "waiting" on global flag while output is per-session (465-471), verify banner correctly per-session (636) so they can disagree; (8) chat page showEmptyState/side-panel/Send-Stop (415,524,811); (9) GlobalChatDock (48,222), incl. OS mode.
Routing hazards: (10) integration_ready wrong session (429); (11) chat_answer/integration_build_intent activeSessionId fallback (374,403).
Invisibility: (12) no per-session status in any session list; no toast on non-active completion.

Concurrency precedent to reuse: `hooks/useAutomationRun.ts` (177-271) has a module-level ref-counted per-runId stream manager (`runEntries` Map) supporting N concurrent streams — the model for multi-session job streams. Store's per-session `sessionJobs[*].status` is already the right source for badges.

Key files: orchestration.ts, useJobStream.ts, useAgentExecution.ts, lib/api/stream.ts, chat-runtime.tsx, providers/api-provider.tsx, chat/[[...sessionId]]/page.tsx, builder/{chat-panel,sessions-panel,output-panel,side-panel}.tsx, chat/global-chat-dock.tsx, stores/{toast,i18n}.ts, lib/i18n.ts, hooks/useAutomationRun.ts, shared/src/events.ts (JobEvent 57-102, NotificationEvent 179-199).
Status: COMPLETE. Exploration finished; full report was sent moments ago. Resending it in full below in case it crossed with your status check.

# Frontend job-event path — trace and single-active-stream audit

No `.codegraph/` exists; direct reads of `web/` + `shared/src/events.ts`. The live-run architecture funnels through ONE shell-mounted controller (`ChatRuntimeProvider`) owning ONE build-execution hook bound to the ACTIVE session, ONE job SSE stream, and a GLOBAL `isExecuting` boolean. Per-session DATA exists in the store; the CONTROL PLANE is singular.

## 1. Orchestration store — state shape + global isExecuting
`/Users/ggomes/dev/ekoa-code/web/stores/orchestration.ts`
- Per-session maps (keyed by sessionId): messages(191), sessionJobs(194), sessionPreviews(197), sessionFiles(200), sessionSidePanelStates(206), activeIntegrationBuilds(211), activityMessages(214), retryContexts(217), streamingChat(220), streamingThinking(225), queuedMessages(229), composerDraft(234).
- Global single-value: activeSessionId(188), isExecuting(208), sidePanelState(204), sidePanelTab(207), pendingAttachments(237), pendingDelegation(240).
- SessionJobState(77-100) fully models per-session status: idle|queued|running|completed|failed|cancelled + phase/progress/output. Per-session run truth lives at sessionJobs[X].status — nothing surfaces it.
- Setter(981). setActiveSession FORCE-RESETS isExecuting:false on switch (678-683) — flag tracks active session only. initializeBuilderSession also resets it (1168). Persist sanitizes running/queued→idle (1581).

## 2. useJobStream — single job SSE hook
`/Users/ggomes/dev/ekoa-code/web/hooks/useJobStream.ts`
- useJobStream(jobId, sessionId?) (106) — one job, one session. NO client-side trace filtering; stream server-scoped (246-248).
- Bound to active session, TORN DOWN on switch (disconnect() in sessionId-change effect 707-730) + unmount (677-683). Backgrounded builds stop live events; recovery is status-only.
- addOutputToStore falls back to store.activeSessionId (152-153) → output MISATTRIBUTED to wrong session.
- Handlers write sessionJobs[sessionId]: artifact(427), preview_reload(449), plan_step(374), complete(468), error(547).

## 3. SSE client — EventSource, per-stream
`/Users/ggomes/dev/ekoa-code/web/lib/api/stream.ts`
- Native EventSource (147, only instance). URL …?token=<token> (146). Named-event dispatch (221-232). Reconnect: native Last-Event-ID; hard CLOSED → backoff 500ms×1.5^n cap 15s (153-180). activeStreams set + token/resilience listeners (38-65).
- Four scoped factories (242-261): chat-run/job/automation/notifications. Each opens its OWN EventSource — TRANSPORT supports N concurrent streams. Scoping by URL, NOT trace_id. Single-active constraint is imposed above, in the hooks.

## 4. Rehydration (papers over missed events)
- useAgentExecution mount effect (hooks/useAgentExecution.ts 359-391): running/queued → GET /jobs/:id, reconnect or write terminal status. Restores build on navigating back.
- useJobStream 2nd-ready re-sync (255-267). initializeBuilderSession (orchestration 1263-1291) GET /jobs/:id per session on mount; artifact-list rehydrate (1209-1261). complete reloads file tree (521). Net: events dropped during a switch window recovered as terminal status + file refetch, NOT a faithful replay.

## 5. Session-list UI — NO live status
`/Users/ggomes/dev/ekoa-code/web/components/builder/sessions-panel.tsx` cards (216-324): only active-teal-dot (232-234), messageCount (283-285), updatedAt (287-289). No read of sessionJobs[id].status. Per-session badge goes in card header ~252-259. Same gap in mobile-sessions-drawer.tsx and dock switcher (global-chat-dock.tsx 123-135). sidebar.tsx shows nothing.

## 6. Notifications/toasts
- Toast store /Users/ggomes/dev/ekoa-code/web/stores/toast.ts — toast.success/error/info(msg, {action:{label,onClick}, duration}), callable anywhere (46-63); rendered by components/ui/toaster.tsx. Ready for "build finished in another session". NOT wired to run completion.
- Server push: NotificationEvent stream opened once in components/providers/api-provider.tsx (66-93), per-user.

## 7. Chat send + in-flight guard
sendMessage in chat-runtime.tsx (754-827). Guard GLOBAL (762-767): while isExecuting → QUEUE not send. Composer not hard-disabled — chat-panel.tsx keeps textarea live, queue+Stop (574-604); empty-state swaps Send→Stop (chat page 811-829). handleChatSend also guards (471).

## 8. Queued follow-up + notification handlers
- Queue flush (chat-runtime.tsx 833-847): SINGLE executingSessionRef, flushes only if still on that session. Queue store per-session; driver is not.
- build_intent(321-365): origin-filtered on SINGLE chatTraceIdRef.current (331) + single buildIntentHandledRef(320). chat_answer(371-395): event.sessionId||activeSessionId(374), drops Stopped runs via single cancelledTracesRef(133). integration_build_intent(400): sessionId||activeSessionId(403). integration_ready(426-458): activeSessionId ONLY (429) — event has no sessionId (shared/src/events.ts 189) → WRONG session if navigated away.

## 9. Message thread rendering / typing
chat-panel.tsx: renders messages[sessionId] filtered isEssential (246-250) via MessageBubble(617). NOT a discriminated union — ChatMessage (orchestration 21-50) informally keyed by role + metadata.type (text|tool_use|status|error|result|skill|activity|…). Switch on role (646) then metadata.type (699-703). Live stream = StreamingChatSection (1076-1104). Distinct side-question thread: add a new metadata.type + a MessageBubble branch.

## 10. i18n
Two systems: (a) formal useI18nStore (default 'pt', persisted ekoa_language) + useTranslation() + web/locales/{pt,en}.ts (~1615 lines) typed by types.ts; non-React via web/lib/i18n.ts. (b) ~24 inline language==='pt'?…:… ternaries, concentrated in chat-runtime.tsx (345,414,444,619,636,721,773) + useAgentExecution.ts (231,319). New copy → locale tables, not inline ternaries.

## 11. Everything that breaks with two concurrent running jobs
Root-cause singletons: (1) global isExecuting reset on switch (208/680); (2) single useAgentExecution(activeSessionId) (chat-runtime 120), internal jobIdRef/previewStartedRef (68-69); (3) useJobStream one stream torn down on switch + activeSessionId misattribution; (4) single chat-run refs chatStreamCleanupRef/chatTraceIdRef/cancelledTracesRef/buildIntentHandledRef (125/128/133/320) — 2nd chat run overwrites them, breaking Stop + build_intent filter; (5) single executingSessionRef (833).
UI misbehaving (global flag + active-session content): (6) ChatPanel spinner/timer/stream (205,413-456); (7) OutputPanel "waiting" on global flag while output per-session (465-471), verify banner per-session (636) so they can disagree; (8) chat page showEmptyState/side-panel/Send-Stop (415,524,811); (9) GlobalChatDock (48,222), incl. OS mode.
Routing hazards: (10) integration_ready wrong session (429); (11) chat_answer/integration_build_intent activeSessionId fallback (374,403).
Invisibility: (12) no per-session status in any session list; no toast on non-active completion.

Concurrency precedent to reuse: hooks/useAutomationRun.ts (177-271) — module-level ref-counted per-runId stream manager (runEntries Map) supporting N concurrent streams. Store's per-session sessionJobs[*].status is already the right source for badges.

Nothing further pending on my side.
