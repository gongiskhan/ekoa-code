# 05. Agent execution

This chapter specifies how the rebuilt Cortex runs agent work: the job lifecycle from creation to terminal state, the Claude Agent SDK integration that executes all user work (FIXED-3), context assembly consumed from the content loader (chapter 08), and the typed streaming pipeline that feeds the SSE endpoints of chapter 03. It covers every run class: chat runs, build jobs, assistant replies for built apps, integration-builder sessions, brand-research jobs, agent-face runs, artifact-backend invocations, and automation runs (lifecycle only; engine internals port per reference/carryover-audit.md B7-B10, B24). Ground truth is reference/invisible-behaviors.md section 7 (normative throughout this chapter) and section 2.7, plus reference/llm-usage-map.md sections 2 and 5. The module owning this chapter is `api/src/agents/` (chapter 02); all model access goes through `api/src/llm/` (FIXED-3; chapter 06). Visual companion: diagram `spec/diagrams/04-agent-job` (FIXED-12: any change to this lifecycle updates that diagram in the same unit of work).

## 5.1 Run classes

| Run class | Created by | Persistence | Stream | Model attribution (ch06) |
|---|---|---|---|---|
| Chat run | `POST /chat/runs` (ch03 3.8.7) | in-memory registry only (5.3.1) | `GET /chat/runs/:id/events` | user_work (`chat`) |
| Build job | `POST /jobs` kind `build` (ch03 3.8.8) | `jobs` collection (ch04 4.3.1) | `GET /jobs/:id/events` | user_work (`build`) |
| Brand-research job | `POST /branding/research` -> jobs resource, kind `brand-research` (ch03 3.8.4) | `jobs` collection | `GET /jobs/:id/events` | user_work (`brand-research`) |
| Assistant reply (built apps) | served-app assistant endpoint (ch03 3.9) | none (synchronous) | none - result in the response | user_work (`assistant-chat`, ch06 6.4.1 row 3) |
| Integration-builder session | `POST /integration-builder/chat` (ch03 3.8.14) | builder-session state in `integrations/` (5.6.9) | none - result in the response | user_work (`integration-builder`, ch06 6.4.1 row 4) |
| Agent-face run | `POST /api/v1/agent-face/run` (ch03 3.10) | in-memory registry | P-18 channel (ch03) | user_work (`agent-face`) |
| Artifact-backend invocation | trigger delivery / sample-run (ch03 3.8.11) | invocation ring, in-memory (5.6.6) | none | user_work (`artifact-backend:<entrypoint>`, billed to artifact owner) |
| Automation run | `POST /automations/:id/runs`, plan rehearsal, trigger delivery | `automation_runs` collection (ch04 4.3.1) | `GET /automations/runs/:id/events` | user_work (vision/planner sites, reference/llm-usage-map.md section 5) |

All eight classes execute in-process. There is no distributed queue and no worker pool - single multi-org process is FIXED-8, and today's system runs every job immediately in-process (reference/invisible-behaviors.md section 7.2: "No queue, no scheduler"). What changes is crash accountability, via the persistent job registry of RESOLVED (P-10), below.

## 5.2 Job lifecycle

Every asynchronous run class follows one lifecycle (FIXED shape, CONV-3; wire pattern in ch03 3.5):

```
create -> validate -> billing gate -> run (in-process) -> stream -> complete | fail | cancel
```

States: `created`, `running`, `completed`, `failed`, `cancelled`. The old `queued` state existed only for the instant between create and the running update (reference/invisible-behaviors.md section 7.2); the rebuild names that instant `created` and transitions to `running` before the creating request returns. Automation runs extend the set with their carried pause states (`awaiting_integration`, `paused_for_user`, `awaiting_consent`, `awaiting_daemon` - ch03 3.6.3).

Ordered creation pipeline, normative for chat runs and build jobs:

1. **Register first.** The run record and its `AbortController` are registered in the run registry synchronously, before any await - a fast Stop must always find its target (carried: `registerChatRun` happens before the billing await, reference/invisible-behaviors.md section 7.1; agent-face registers before its first await, section 7.5).
2. **Respond early.** The creating POST returns `202` with the server-minted id as soon as the record exists (ch03 3.4 retires client-minted trace ids). Results arrive over the run's SSE stream; a creation-pipeline throw after the response becomes a terminal `error` event on the stream.
3. **Billing gate.** `checkAllowance(userId)` from `billing/` (ch06). Blocked: emit terminal `error` with code `BILLING_BLOCKED` and details carrying the billing URL, mark the run `failed`, stop (carried semantics, reference/invisible-behaviors.md sections 7.1, 7.2 - including the old misspelling `BILLing_BLOCKED`, which is NOT carried; the code is `BILLING_BLOCKED`).
4. **Abort checkpoint.** Re-check the abort signal after every await in the creation pipeline (carried: early-abort check after the billing await, final pre-execution check - section 7.1).
5. **Classify.** The tier classifier in `llm/` produces the routing decision (chat floored at the standard tier, builds floored at the expert tier - reference/llm-usage-map.md section 4 rows 1-2). A `routing` event is emitted on job streams (ch03 3.6.2).
6. **Run.** The agent executes through the `llm/` chokepoint with injected stream callbacks (5.6). Terminal state is owned exclusively by the completion/error callbacks (carried: fire-and-forget launch with callback-owned terminal state, section 7.2).
7. **Finalize.** Exactly one terminal transition per run (the dual-fire guard, 5.3.4), followed by the terminal SSE event.

### 5.2.1 RESOLVED (P-10) - persistent job registry with orphan sweep

A minimal persistent job registry, still with no distributed queue.

- Build and brand-research jobs persist to the `jobs` collection (ch04 4.3.1) at creation and on every status change. Automation runs already persist to `automation_runs` (ch04).
- **Boot orphan sweep:** at startup, every `jobs` document and every `automation_runs` document still in a non-terminal state is marked `failed` with `error.code = 'ORPHANED'`, and the associated artifact (if any) is reset to `draft`. This replaces today's same-process-lifetime-only safety net: a Cortex restart currently orphans on-disk `running` jobs forever (reference/invisible-behaviors.md section 7.2, the Conflicts #14 note).
- **In-process zombie net carried:** the run wrapper's `finally` block still flips a run that is somehow non-terminal after the pipeline exits to `failed { code: 'PIPELINE_STUCK' }` and resets the artifact to `draft` (carried, section 7.2). The orphan sweep is the cross-restart complement, not a replacement.
- **Chat runs stay ephemeral by design.** They live only in the in-memory run registry; after a crash, `GET /chat/runs/:id` returns 404 and the client treats the run as terminated (the reconnect re-sync of ch03 3.6 handles this). Persisting per-turn chat runs would add write load for no recovery value - the chat transcript itself is persisted per message (ch04 `messages`).
- **Still no queue.** Jobs run immediately in-process; concurrency is bounded only by the named guards of 5.3 (carried concurrency model, reference/invisible-behaviors.md section 7.6). Single process is FIXED-8.

Rejected alternative: keep the status quo (per-file job records, no boot sweep). Crash-orphaned `running` jobs are the single biggest operational defect the reference audit names in this area (section 7.6 closing note), so the status quo is not carried.

Resolved: ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### 5.2.2 Run records (normative shapes)

The persisted job record (`jobs` collection, ch04 4.3.1) and the in-memory chat-run entry. Wire-facing projections of these live in `shared/jobs.ts` and `shared/chat.ts` (ch03); the shapes here are the server-side superset:

```ts
// jobs collection document (persisted per P-10)
interface JobRecord {
  id: string;                        // server-minted
  kind: 'build' | 'brand-research';
  status: 'created' | 'running' | 'completed' | 'failed' | 'cancelled';
  userId: string;                    // owner; cancel scope
  sessionId?: string;                // build jobs: originating chat session
  artifactId?: string;               // set at creation (follow-up) or first-build artifact creation
  request: { description: string; language: string; templateId?: string;
             integrationKeys?: string[]; attachments?: UploadRef[];
             fieldValues?: Record<string, unknown>; configValues?: Record<string, unknown> };
  routing?: { tier: string; reason: string };   // stamped at step 5 of 5.2
  result?: { text?: string; slug?: string; appUrl?: string };
  error?: { code: string; message: string };    // sanitized before persist (FIXED-8)
  createdAt: string; startedAt?: string; endedAt?: string;   // ISO-8601 UTC (ch03 3.4)
}

// in-memory run registry entry (chat runs, agent-face runs; jobs also register here while live)
interface LiveRunEntry {
  id: string;
  ownerUserId: string;               // owner-scoped cancel (5.3.1)
  abort: AbortController;            // shared by cancel and timeout (5.3.6)
  finalized: boolean;                // dual-fire guard (5.3.4)
  timedOut: boolean;                 // timeout-vs-Stop discrimination (5.3.6)
  startedAt: number;
}
```

Registry rules: an entry is inserted synchronously at creation (5.2 step 1) and removed in the run wrapper's `finally`; the persisted `JobRecord` outlives the entry and serves `GET /jobs/:id` after completion. Error objects persisted to `JobRecord.error` pass the egress sanitizer first - a raw provider string must never be stored where a later read could surface it (5.3.7; ch09).

## 5.3 Carried guards (each is a contract, not an implementation suggestion)

Every guard below encodes a production incident or a proven race. Each requires at least one automated test (chapter 13).

### 5.3.1 Owner-scoped idempotent cancel

`POST .../:id/cancel` is the only way to stop a run. Closing the SSE stream must never stop the run - unsubscribing only stops reading while the SDK keeps generating and billing (carried, reference/operations-inventory.md section 0.1). Cancel resolves the run in the in-memory registry, verifies the caller owns it (an org-admin may also cancel build jobs in its own org, super-admin anywhere - carried owner-or-admin rule remapped to the three-role model, reference/invisible-behaviors.md section 7.2), and is idempotent: cancelling a terminal or unknown run returns `{ cancelled: false }` without error. Ordering is load-bearing: cancel sets the status to `cancelled` **before** firing the abort, so the abort path observes the cancelled state and stays quiet instead of double-reporting (carried, section 7.2 cancel-job).

### 5.3.2 Abort never falls through to a build

`llm/`'s one-shot entry points reject with a typed `LlmAbortedError` on user abort; they never resolve with an empty string (chokepoint API owned by ch06 6.2.1). Classifier consumers propagate that rejection and bail with no side effects: an abort must never reach the deterministic fallback classification, because the fallback defaults to "modification" and would start a build after the user pressed Stop (reference/invisible-behaviors.md section 7.2 in-build classifier). The historical hazard being fixed here: the old one-shot helper returned an empty string on abort and left the guard to per-caller re-checks of the abort signal (reference/llm-usage-map.md Conflicts 11; disposition in ch06 6.8 row 11 - fixed at the chokepoint, not by caller discipline). The invariant is FIXED in effect: fallbacks fire on failure or timeout, never on abort (ch06 6.4.2; reference/llm-usage-map.md section 6, `classifyInBuildIntent` row).

### 5.3.3 Duplicate-first-build TTL reservation

First builds (no `artifactId` on the request) reserve a slot in an in-memory map keyed by `sessionId`, **synchronously before any async work**. A second `POST /jobs` for the same session while the reservation lives binds to the running job and returns it (same `{ status: 'created', job }` shape, pointing at the existing job). TTL 45 minutes - deliberately above the 40-minute wall-clock ceiling. Root cause carried verbatim: the `build_intent` notification event broadcasts to every open tab, and without the reservation each tab starts a build (reference/invisible-behaviors.md section 7.2). The reservation is released in the run wrapper's `finally`, guarded by job id so a late release cannot free a newer reservation.

### 5.3.4 Dual-fire finalized guard

Exactly one of complete/error may finalize a run. After a wall-clock race rejection the SDK subprocess may still invoke the completion callback; a `finalized` flag per run makes the second arrival a no-op (carried, reference/invisible-behaviors.md section 7.2).

### 5.3.5 One follow-up build per artifact

A follow-up job (request carries `artifactId`) is rejected with `409 DUPLICATE_BUILD` when another non-terminal job targets the same artifact: two concurrent builds would resume the same SDK transcript file and corrupt it (carried, section 7.2). The server resolves `projectDir` from the artifact record - never from the client, which no longer sends it (ch03 3.8.8) - because SDK session resume keys off the realpath-encoded working directory (carried, section 7.2).

### 5.3.6 Timeouts: inactivity plus wall clock

Two independent timers race the run (carried values as named config constants):

| Timer | Default | Behavior |
|---|---|---|
| Chat run timeout | `CHAT_RUN_TIMEOUT_MS` 300 000 | one timer; a `timedOut` flag distinguishes timeout (surfaces a terminal `error`) from user Stop (silent) - carried, reference/invisible-behaviors.md section 7.1 |
| Build inactivity | `BUILD_INACTIVITY_TIMEOUT_MS` 300 000 | reset on every stream/tool callback - an actively producing build never times out (carried, section 7.2) |
| Build wall clock | `BUILD_WALL_CLOCK_MS` 2 400 000 | absolute ceiling regardless of activity (carried, section 7.2) |

On a timeout race rejection: if the abort signal is already set, stay quiet (cancel owns the terminal state); otherwise route through the finalized-guarded error path (carried, section 7.2).

### 5.3.7 Provider errors never masquerade as results

Two marker scanners - one for auth errors (including org-level access-loss strings the SDK returns as result text), one for transient provider errors (429/529/overloaded/rate-limit, including the consumer-plan limit message) - run over stream events and final results (carried, reference/invisible-behaviors.md section 2.7). Three consequences, all carried:

1. A provider error returned **as** the result text is rerouted to the error path; this exact wrap produced a fake "completed" build in the 2026-07-03 production rate-limit incident (section 7.2 onComplete step 1).
2. An assistant message whose text matches either scanner is **not persisted** to the session transcript - a raw provider error must never be re-injected into future prompts (section 7.1 step 7).
3. Mid-stream auth signals are tracked so a subsequent subprocess crash (parsing a plain-text 401 body) is synthesized into a proper auth error instead of a JSON parse crash (section 2.7).

### 5.3.8 Concurrency guard summary (carried from reference/invisible-behaviors.md section 7.6)

| Guard | Scope | Mechanism |
|---|---|---|
| One first-build per chat session | 45-min TTL | synchronous reservation map (5.3.3) |
| One follow-up build per artifact | registry query for non-terminal job on same artifact | reject 409 (5.3.5) |
| One cancelable run per id | in-memory run registry | owner-scoped cancel (5.3.1) |
| One esbuild watch context per app | prior context disposed | replace (ch07) |
| Git writes per app repo | per-projectDir promise chain | single shared repo lock across auto-commit, file-save commit, restore, and GitHub push (ch07) |
| Artifact-backend invocations per artifact | per-artifact promise lane | serialized (5.6.6); different artifacts concurrent |
| Chat runs | none | unlimited; each run is one SDK subprocess (carried; revisit only with founder consent) |

## 5.4 Agent SDK integration

The Claude Agent SDK is the execution engine for all user work (FIXED-3): it is the product and the billable surface, and it is the only strong-model path on managed OAuth. The SDK invocation mechanics below are implemented inside `api/src/llm/` (the chokepoint; ch02 forbids `agents/` from importing the SDK); the policy - which run class gets which tools, context, and limits - lives in `agents/` and is specified here. Attribution and metering are chapter 06's contract; this chapter fixes the execution semantics.

### 5.4.1 Subprocess environment (carried from reference/invisible-behaviors.md section 2.7)

The SDK subprocess environment is built fresh per run:

- **Inherited provider env is always scrubbed first.** Any inherited `ANTHROPIC_API_KEY`, `ANTH_API_KEY`, and `ANTHROPIC_BASE_URL` are deleted before any injection, so no provider credential or base URL leaks in from the host process (FIXED-8 *(amended 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md): credentials are centrally managed with two auth modes as per-environment configuration - subscription OAuth and Anthropic API key - never per-user ad hoc, never a `~/.claude` fallback)*).
- **The configured auth mode then injects exactly one credential from central custody** (the `credentials` singleton, ch04 §4.5; ch06 §6.2): `oauth` mode injects `CLAUDE_CODE_OAUTH_TOKEN`, `api-key` mode injects `ANTHROPIC_API_KEY`. Never both, never an inherited value - the mode's credential comes from custody or the run does not start (there is no fallback). `ANTHROPIC_BASE_URL` is then set - regardless of mode - to point the subprocess at the internal `llm/` chokepoint (FIXED-13 unchanged), so the SDK's egress funnels through the anonymisation pipeline and metering before it reaches Anthropic (chapter 17.2; ch06). This is a repoint to the platform-controlled chokepoint, not a bypass - a user- or environment-supplied provider base URL never survives into the subprocess, and the chokepoint is the one sanctioned egress path.
- `CLAUDECODE` is deleted (prevents nested-session detection).
- `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS='1'` is set.
- Build runs additionally set `HOME = projectDir`, confining `~` expansion to the sandbox (carried, section 7.3).
- Agent-face runs raise `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` to 180 000 ms - daemon tool calls routinely exceed 60 s and the bridge invocation timeout is 120 s (carried, section 7.5).

`settingSources: []` on every invocation: the production agent inherits nothing from any developer's `~/.claude` profile; everything the agent needs ships in the repo via the content loader (FIXED-6; carried, section 7.3).

### 5.4.2 Warm subprocess and auth retry (carried from section 2.7, amended 2026-07-06)

- A pre-warmed SDK subprocess handle (~20x faster first response) is maintained, single-use, and **invalidated whenever the credential refreshes** via the custody module's refresh callback.
- The environment holds **one credential** (the `credentials` singleton, ch06 §6.2); in `oauth` mode it is **proactively refreshed before expiry**. On a detected auth error the run forces one refresh, invalidates the warm handle, and retries **once**; a persistent refresh failure raises the alert surfaced on `/health` `claudeAuth` (ch06 §6.2.4). Transient provider markers retry with backoff `[5 s, 15 s]`. Exhaustion surfaces a real error - never a fake completion. User abort resolves silently.
- This chapter's dependency on the custody module is only: token available at run start, warm handle invalidated on refresh. The simplified credential semantics - one credential per environment, proactive refresh, refresh-and-retry-once, alert on persistent failure - are chapter 06 territory (§6.2, §6.2.4); the previous rotation machinery (single-flight mutex, persist-first, never-delete-on-401, peer adoption, non-unref'd watchdog, credential pools, health scoring, selection logic) is deleted from the spec (Amendment 2 Part 1).

### 5.4.3 The OAuth model-access asymmetry (environmental constraint, recorded)

In **subscription-OAuth mode**, managed OAuth direct REST authorizes the cheap tier only - the standard and expert tiers return 400 on that path; the SDK subprocess authorizes all tiers (reference/llm-usage-map.md section 2, Conflicts 7; confirmed live 2026-05-31). Consequences the rebuild inherits deliberately: the ekoa-local gateway clamps to the cheap tier on the wire; vision and the automation planner route their expert-tier one-shot calls through the SDK; and any future replacement of the Agent SDK must first re-solve strong-model access. In **api-key mode** (FIXED-8 as amended, ch06 §6.2) there is no such asymmetry - direct REST reaches all tiers - but the chokepoint keeps its conservative `completeFast` FAST-only typing regardless of mode (ch06 §6.2.2), so the routing design here holds unchanged under both modes. Recorded here because it silently shapes every routing decision in this chapter.

### 5.4.4 Invocation options per run class (carried from section 7.3)

| Run class | Tools | Session persistence | maxTurns |
|---|---|---|---|
| Build | full coding preset (`Bash/Read/Write/Edit/Glob/Grep/Agent` + context-loading tool) + knowledge tools, permission bypass, `cwd = projectDir`, attachment directories added | persisted; resumed on follow-ups | `MAX_TURNS_BUILD` 100 |
| Chat | **only** the two knowledge tools (`knowledge_search`, `knowledge_read`, in-process MCP) - never Bash/Write/Edit | per-turn | `MAX_TURNS_TEXT` 30 |
| Text + attachments | `Read/Glob/Grep` only | per-turn | 30 |
| Pure text (one-shot helper) | none | none | 30 |
| Agent-face | daemon-RPC tools only: default-deny everything not daemon-namespaced, 16 host built-ins disallowed, permission checks active (bypass would skip the allowlist callback) | per-run | 30 |

Common options: model and effort from the routing decision (effort is the only reasoning knob on the wire - thinking budgets are dead today and are not carried, reference/llm-usage-map.md Conflicts 5; ch06); partial-message streaming on; optional abort signal; the mandatory language block appended last for non-English output (carried); image attachments switch the prompt to an async message iterable with base64 image blocks - the vision path used by automation (carried, section 7.3).

### 5.4.5 Session resume via sdkSessionId

The SDK reports its session id exactly once, on the first event carrying one; the run pipeline persists it as `sdkSessionId` on the artifact record **only when it differs** from the id it resumed with (carried, section 7.2). Follow-up builds pass `resumeSessionId = artifact.sdkSessionId` and run in the artifact's `projectDir` (5.3.5). This pair - session id plus realpath-stable working directory - is the whole resume contract.

### 5.4.6 Event loop discipline (carried from section 7.3)

Text deltas feed the stream callback; usage deltas feed billing capture (final counts are the source of truth - ch06); tool-use blocks feed the tool callback; the `result` event captures usage for both success and error subtypes, and success text wins over accumulated stream text. The loop **breaks immediately after the result event** - the SDK iterator can hang after subprocess exit. Billing is recorded once, inside the chokepoint, per call (FIXED-3; callers never record - double-billing is the failure mode, reference/llm-usage-map.md section 8).

### 5.4.7 Named configuration constants introduced by this chapter

All tunables in this chapter are named config values in `config.ts` (ch02), never inline literals. Defaults carry today's values:

| Constant | Default | Used by |
|---|---|---|
| `CHAT_RUN_TIMEOUT_MS` | 300 000 | 5.3.6 chat timer |
| `BUILD_INACTIVITY_TIMEOUT_MS` | 300 000 | 5.3.6 inactivity timer |
| `BUILD_WALL_CLOCK_MS` | 2 400 000 | 5.3.6 wall clock |
| `FIRST_BUILD_RESERVATION_TTL_MS` | 2 700 000 | 5.3.3 (wall clock + 5 min margin) |
| `MAX_TURNS_BUILD` | 100 | 5.4.4 |
| `MAX_TURNS_TEXT` | 30 | 5.4.4 |
| `TRANSIENT_RETRY_BACKOFF_MS` | [5 000, 15 000] | 5.4.2 |
| `AGENT_FACE_STREAM_CLOSE_TIMEOUT_MS` | 180 000 | 5.4.1 agent-face env |
| `BACKEND_INVOKE_TIMEOUT_MS` | 60 000 | 5.6.6 per-invocation wall clock |
| `BACKEND_STARTUP_TIMEOUT_MS` | 15 000 | 5.6.6 worker startup race |
| `BACKEND_IDLE_TIMEOUT_MS` | 300 000 | 5.6.6 idle worker recycle |
| `BACKEND_DRAIN_BACKSTOP_MS` | 60 000 | 5.6.6 revoke drain |
| `MEMORY_AUTO_EXTRACT_ENABLED` | true | P-12 (5.8): platform kill switch; the per-user `memory.autoExtract` toggle (default ON) rides user settings |
| `TOOL_RESULT_TRUNCATE_CHARS` | 200 | 5.7.1 tool_event payloads |

### 5.4.8 Delegation to the local daemon (`delegate_to_local`)

The hosted agent gains one delegation tool, `delegate_to_local(task, grant_refs, budget)`: it delegates a task to the user's paired local daemon over the bridge, which runs the fixed file-tool vocabulary against the roots the user granted and returns a result. Chapter 18 owns the wire contract, the daemon side, and the security model; this chapter records only what the tool means to a run. The rule is **derived output only** - the hosted conversation receives summaries, citations (path plus line range), patch proposals, and ledger references; raw local file content never enters the hosted context window and is never written to any hosted store or transcript (the Ekoa Local v2 brief, I2; chapter 18.2). Offline behavior is honest: when no daemon is paired or the bridge is unreachable the tool fails (surfaced like agent-face runs, `409 DAEMON_NOT_CONNECTED`, 5.6.5) and never degrades to uploading local files as a fallback. The tool is exposed to the hosted chat and build run classes; agent-face runs are the distinct daemon-face path and already run daemon-RPC tools directly (5.4.4).

Session identity propagates through delegation: the hosted conversation id flows through the `delegate_to_local` call into the bridge provider requests, so chapter 17's anonymisation vault is one-per-conversation across both faces - the hosted turn and the delegated daemon turn share a single vault keyed by that conversation identity, which keeps deterministic per-session tokenization coherent when a conversation spans delegation (chapter 17.5). The correlation id minted at the chokepoint per provider request rides along and joins the daemon ledger (chapter 18).

## 5.5 Context assembly

`agents/` assembles the full context for every run from four sources. The interface below is what this chapter consumes; chapter 08 owns the loader's internals.

### 5.5.1 The content loader interface (consumed from chapter 08)

```ts
// api/src/content/ public surface (ch08 owns the implementation)
assembleAgentContext(input: {
  agentKind: 'coding' | 'chat' | 'automation';
  userId: string;
}): Promise<{
  contextDir: string;          // per-user composition directory the SDK is pointed at
  promptSections: string[];    // ordered system-prompt sections from agent-context content
  contentVersion: string;      // content-addressed cache key, for audit/event payloads
}>
```

Per FIXED-6 the loader assembles per-user composition directories from a shared content-addressed cache and returns them; it is a context loader, not a framework - it defines no routes, no schemas, no runtime logic. `agents/` treats `contextDir` and `promptSections` as opaque inputs. The `context_event` stream events (ch03 3.6.1) are emitted when the agent loads or uses a piece of that content at runtime.

### 5.5.2 Grounding layers composed by `agents/` (carried from sections 7.3 and 11.3)

Applied in order on top of the loader output:

1. **Memory injection** - the deterministic term-overlap resolver (`memory/`, no model call) selects core-tier always plus top scored active-tier memories; guardrail memories render first as non-negotiable RULE lines; resolution unless the run opts out. The resolver's write-on-read side effect (usage-count bump per resolved memory) is carried as a conscious decision (reference/invisible-behaviors.md section 11.3). Scope in v1 per P-12 (5.8).
2. **Knowledge grounding** - the cited-or-silent grounding block from `knowledge/`: always for chat runs; for builds only when the deterministic legal-context detector matches the request (carried, section 7.3; reference/llm-usage-map.md section 5 rows 1-2).
3. **Live integration pre-fetch (chat only)** - keyword hits on email/calendar/files pre-fetch live Google/Microsoft data into the system prompt, with a 60 s cache that also serves keyword-less follow-ups ("sim") (carried - reference/llm-usage-map.md section 5 names it must-preserve).
4. **Automation and integration catalog** - the cross-agent catalog of available automations and integration actions, appended for any run that can invoke them; catalog build failures are non-fatal (carried).
5. **Conversation history** - the prior session transcript travels as structured history, never inlined and clipped (the old inline version lost pasted material - carried fix, section 7.2); tail-window dedup of the last 3 messages; persisted provider-error turns filtered out (5.3.7).

## 5.6 Run classes in detail

### 5.6.1 Chat runs

Pipeline order per 5.2, then (carried from reference/invisible-behaviors.md section 7.1):

1. User message persisted to the session transcript immediately at creation.
2. Timeout and cancel share one `AbortController` (5.3.6).
3. Routing floored at the standard tier; attachments imply the code-generation hint.
4. **In-band marker machinery, server-side only** (5.7.2): delegation and context markers are parsed and stripped in the run pipeline; no marker ever reaches the wire.
5. Stream callbacks map to the typed `ChatRunEvent` union (ch03 3.6.1); tool results truncated to 200 chars in `tool_event` payloads (carried).
6. On completion: context blocks parsed (last valid one persisted onto the session); typed delegation events emitted (5.7.2); `complete` with cleaned result and duration; assistant message persisted unless it matches a provider-error scanner (5.3.7).
7. Guided-mode state and session type resolved through 30 s caches (carried).

The guided-build state machine (today's orchestration phases `idle | gathering | resolving-integrations | building | built | failed`, persisted on the session record) carries as typed TypeScript in `agents/` (FIXED-4). Its three cheap-tier classification calls (build-need detection, integration-needs detection, base-template selection) stay, each with its committed deterministic fallback (reference/llm-usage-map.md section 6). The `phase_changed` broadcast does not carry (P-11, 5.9.2): phase is readable on the session resource, and job progress surfaces through `plan_step` events.

### 5.6.2 Build jobs

Creation (carried from section 7.2, reshaped to ch03 3.8.8):

- **Follow-up detection**: request carries `artifactId`. Server resolves `projectDir` and `resumeSessionId` from the artifact record (5.3.5, 5.4.5).
- **In-build message classifier** runs before any build work for follow-ups, under the abort rules of 5.3.2. Outcomes: modification -> proceed; integration-build request -> emit `integration_build_intent` plus a PT/EN acknowledgement as `chat_answer` on the notifications channel, no job; question/meta/ambiguous -> answer via the in-build answer flow (cheap tier; its hardcoded platform-capability text must be kept in sync with the product or answers will lie - reference/llm-usage-map.md section 5 rows 12-13) delivered as `chat_answer`, response `{ status: 'answered', reason }`, no job. The scrap/meta path resets the guided-build state to `gathering` (carried). Classifier failure is non-fatal and defaults to proceeding with the build (carried) - but never on abort (5.3.2). `chat_answer` for cancelled runs is suppressed server-side (ch03 3.6.4).
- **First-build branch**: fresh artifact and `projectDir` under the user sandbox; scaffold seeding, design-token resolution, and the immediate initial build-and-watch (preview live before the agent runs) execute per chapter 07; the artifact is created `status: 'draft'` with the session, project directory, and job linkage in its data bag (carried, section 7.2).
- **Featured follow-ups** materialize a persistent working copy first (idempotent); failure aborts with a PT error (carried; mechanics in ch07).
- Reservation and duplicate rules per 5.3.3 and 5.3.5. Job persisted per P-10.

Prompt assembly (carried): template configuration values as a structured block; a follow-up preamble for follow-ups; conversation history per 5.5.2 item 5; scaffold context or starting-point block per ch07.

Completion sequence (carried order from section 7.2; build-pipeline mechanics in ch07):

1. Provider-error-as-result reroute (5.3.7).
2. Final bundle: stop the file watcher first (concurrent esbuild operations on the shared daemon crash the process), clean output, build with 2 attempts, each validated by the bundle-format check.
3. Version snapshot via the app repo lock; broken builds are snapshotted with a failure tag (users may revert FROM a broken version); the secret-commit guard blocks the snapshot loudly with an audit row (FIXED-8 single audit write path); fire-and-forget GitHub mirror push behind its config gate.
4. Slug: preserved on follow-ups (regenerating would rename the app per change request); generated **deterministically only** on first builds - the model-based slug generator is not carried (reference/llm-usage-map.md section 7, fate of call 25).
5. **Per-build verification** (default ON per the user's `build.verifyBuilds` setting - Part 6, founder amendment 2026-07-06): a verification agent exercises the built app through playwright-cli at medium depth, **incremental** - a full acceptance pass on the artifact's first build, scoped tests of the change plus a smoke pass on follow-ups. It fixes forward within the slice retry budget; a failure it cannot fix completes the build with the honest visible note (carried mechanism, surfaced on the `complete` event below). Its model calls are attributed `user_work` `build-verify`, billed to the build's user (ch06 6.4.1 row A2). Chapter 07 owns the verification pipeline mechanics; chapter 12 owns the "A testar a aplicação..." banner and the settings toggle.
6. `complete` event with result (a final-build error, and any unresolved verification failure, appended as a user-visible note), artifact id, slug, and app URL; job -> `completed`.
7. Artifact -> `active` with a **merge** onto its existing data bag - a wholesale replace historically dropped customization and lineage fields (carried, section 7.2).
8. Fire-and-forget screenshot; assistant message persisted. Post-run memory extraction is scheduled **off** the terminal event so it never delays completion: it runs asynchronously, batched per run, as `user_work` `memory-extract` (5.8; P-12 re-resolved).

Error path: terminal `error` event, job `failed { code: 'ADAPTER_ERROR' }`, artifact stays `draft` (carried).

### 5.6.3 Assistant replies (built apps)

Synchronous: the result returns in the HTTP response, no stream (carried, section 7.2 assistant-chat). Builds its own system prompt (personality, app configuration, knowledge via tag-biased memory resolution or inline files, up to 3 fetched web URLs through the SSRF guard), executes one SDK call with a system-prompt override and no-op stream callbacks. The tier is picked by a deterministic greeting/knowledge heuristic in front of the call (carried, reference/llm-usage-map.md section 5 row 3). Assistant replies count as hosted runs, so the returned post-run memory extraction (5.8) mines them as `user_work` `memory-extract`; the old always-off memory co-op flag is not carried as a separate switch.

### 5.6.4 Brand-research jobs

Create via `POST /branding/research`; state and events ride the jobs resource (ch03 3.8.4). The research agent is deliberately tool-less - no Bash/Read - so a prompt-injected page cannot launder server configuration back as "the brand" (carried, reference/llm-usage-map.md section 5 row 5). The visual-vibe side call is dropped (ch06 fate; reference/llm-usage-map.md section 7 call 26); if the signal is wanted later, screenshots attach to this job's SDK session as billed user work.

### 5.6.5 Agent-face runs

Carried per reference/invisible-behaviors.md section 7.5: `409 DAEMON_NOT_CONNECTED` when the user has no bridge connection; run registered synchronously before the first await; routing effectively lands on the expert tier (the "floor at standard" comment in the old code is wrong - reference/llm-usage-map.md Conflicts 8; the rebuild states the truth: complexity-hinted runs classify expert); tool execution swaps to daemon-RPC tools with a default-deny allowlist (5.4.4). **Metering folds into the chokepoint** - the old self-metering block is not carried as a second meter (FIXED-3; ch06 6.5.5). Today cancelled agent-face runs are normally unbilled because abort ends the query before the usage-carrying result event (section 7.5); whether that skip carries is owned by ch06, not this chapter - billing of cancelled runs is RESOLVED (P-19) (ch06 6.9), which lands one uniform rule at the metering point (bill whatever usage the provider reported up to the abort); today's deliberate agent-face skip is the rejected alternative recorded there. Event delivery channel is P-18 (ch03 3.10).

### 5.6.6 Artifact-backend invocations

The per-artifact serialized lane semantics carry **wholesale** (reference/invisible-behaviors.md section 7.7 - normative; module home is `apps/`, ch02, but the invocation is a run class of this chapter):

- **Substrate-swappable runtime contract** (`invoke, shutdown, revoke, dispose` plus status/invocations/logs/enable inspection); v1 is worker_threads - JS-fault isolation, not hardware isolation. A null runtime is the pre-wiring default whose `invoke` returns a clean failure so a trigger delivery racing startup degrades to a retry instead of a crash.
- **Per-artifact serialized promise lane**: one worker per artifact; invocations to one artifact queue in order; different artifacts run concurrently. **All validation (disabled/owner/bundle) happens at lane-turn time, not at enqueue** - an artifact deleted while an invocation waited must be refused, not re-spawn a worker for a gone app.
- **Timeouts**: per-invocation wall clock 60 s default (capability-token TTL derives from it: timeout plus 30 s); a timed-out invocation resolves as failure AND recycles the worker (a hung backend function must not block the lane); worker startup raced against 15 s, with startup death failing fast rather than hanging the lane; idle workers recycled after 5 minutes.
- **Permanent revoke tombstone on delete**: `revoke(artifactId)` adds to the tombstone set synchronously before any await; the lane turn checks the tombstone first and re-checks after each internal await, closing the queued-invocation-after-delete race. Revoke drops liveness, then drains in-flight **mutating** capability RPCs (data writes, notifications - reads and model calls deliberately not drained) against a 60 s backstop, reporting `fullyDrained: false` when a commit blew past it so the caller can surface a possible late write into orphaned app data.
- **Capability token per invocation**: scoped `{artifactId, ownerUserId, scopes, entrypoint, dryRun}`, verified on every worker RPC, artifact-matched, and checked against the pending-invocation map - a backend function that retained the handle and called it after settling gets a structured "invocation already settled" rejection.
- **True dry-run**: suppresses every persistent side effect, capturing each as a typed effect record on the result; reads and model calls still run (and the model call still bills the owner) so the real decision is visible.
- **Warm-worker staleness fix**: the bundle import URL is cache-busted by bundle mtime so a rebuilt backend is re-imported.
- **Failure handling**: backend-function failure never throws - always a structured failure with logs; worker death fails all pending invocations and clears the entry. **No retries at this layer** - retry semantics live in the trigger delivery pipeline (`events/`, ch02).
- **Bounded observability**: invocation ring of 50 per artifact, 200 log lines per invocation, 256 MB worker heap cap; the in-memory disabled set is a non-durable pause (durable pause = disable the trigger).
- The `ekoa.llm` capability routes through the chokepoint at the cheap tier, passed explicitly - the chokepoint has no default tier (ch06 6.2.1; 6.4.1 row 14) - and billed to the **artifact owner**; the worker can choose neither billee nor tier (carried, reference/llm-usage-map.md section 5 row 14).

### 5.6.7 Automation runs (lifecycle only)

Runs are created by `POST /automations/:id/runs`, by plan-with-rehearsal (the plan endpoint's documented double side effect, ch03 3.8.18), or by trigger delivery under the trigger owner's identity. The engine, action runner, fingerprinting, cache, vision service, and browser sessions port per reference/carryover-audit.md B7-B10 and B24 and are not re-specified here. What this chapter fixes:

- **Lifecycle**: `running -> completed | failed | cancelled`, plus the carried pause states `awaiting_integration`, `paused_for_user`, `awaiting_consent`, `awaiting_daemon`, resumable via the ch03 resume/consent endpoints. Run records persist to `automation_runs` at every transition; the P-10 orphan sweep covers them (5.2.1).
- **Events by injection**: the engine emits through an injected emitter callback (the seam already exists - reference/carryover-audit.md B7); the caller wires it to the run's SSE stream (ch02 2.8). The engine never imports `events/`.
- **Cancel/resume/consent** are owner-scoped and idempotent, keyed by the globally unique run id (ch03 retires the old composite key).
- **Model economics recorded**: cache hit replays deterministically with zero tokens; cache miss resolves and verifies via vision pinned to the expert tier at maximum effort - there is no cheap-to-expert escalation ladder (reference/invisible-behaviors.md section 13.2, correcting the stale doc); all of it is user_work billed to the run's user (reference/llm-usage-map.md section 5 rows 8-11).
- The action/assertion cache continues to live in the memory system as tagged rows with structured payloads (reference/invisible-behaviors.md section 13.3; ch04 memories collection); step feedback evicts fingerprint-matched entries and may write a correction memory (deterministic writers, carried - section 11.6).
- **Retry boundary**: the engine and the backend runtime never retry themselves; all retry semantics for triggered work live in the trigger delivery pipeline in `events/` (carried schedule: 30 s / 2 m / 10 m / 1 h / 6 h with jitter, then dead-letter after 5 attempts; boot recovery of stuck deliveries - reference/invisible-behaviors.md section 12.3). A trigger-started run that ends non-`completed` counts as a delivery failure and re-enters that schedule; a user-started run does not retry at all. This chapter's run classes expose exactly one attempt each.

### 5.6.8 Reconnect and re-sync semantics

Carried pattern, normalized across all streaming run classes (reference/frontend-cleanup-audit.md FC-026; ch03 3.6 mechanics):

- Each stream opens with `ready`; the client re-syncs authoritative state after any reconnect via the corresponding `GET /:id` - events are presentation, the resource is truth.
- The per-stream replay ring (200 events, 300 s idle sweep) means a client reconnecting within the window with `Last-Event-ID` misses nothing; one reconnecting later gets `ready` plus the re-synced resource state and accepts the gap.
- Terminal states are readable forever on persisted run classes (`GET /jobs/:id`, `GET /automations/runs/:id`) and until process exit for chat runs (5.2.1). Subscribing to the events URL of an already-terminal run yields `ready` followed immediately by the terminal event replay when still in the ring, else just `ready` - the client must always pair subscription with the state read.

### 5.6.9 Integration-builder sessions

Synchronous like assistant replies (5.6.3): `POST /integration-builder/chat` (ch03 3.8.14) returns the result in the HTTP response, no stream - the old incremental `builder_text` stream is not carried (dropped per ch03 P-04 recommendation; its run correlation was broken by design, reference/frontend-cleanup-audit.md FC-035), so the route carries the explicit 300 s timeout (ch03 3.4) as the backstop. Execution semantics:

- One SDK call per builder message through the `llm/` chokepoint, executed by `agents/` on behalf of the `integrations/` builder routes, attributed user_work `integration-builder` at the standard tier (ch06 6.4.1 row 4; the old dead `isCodeGen: true` flag is not carried - reference/llm-usage-map.md Conflicts 9, disposition in ch06 6.8).
- **Billing gate delivery is synchronous**: when this entry is gated (ch06 6.6.3, where its coverage is decided), a blocked request returns the ch03 error envelope with code `BILLING_BLOCKED` and HTTP 402 in the response - never a stream event.
- No entry in the async run registry and no cancel endpoint: there is no wire-visible run to stop; the route timeout bounds the call.
- Builder-session state - `builderSessionId`, accumulated messages, the generated package, validation errors (ch03 3.8.14 chat/load shapes) - is owned by `integrations/` (ch02; the builder-agent session logic ports per reference/carryover-audit.md B25). This chapter owns only the model-call execution semantics above; package save (`PUT /integration-builder/package`) and its `integration_ready` notification are `integrations/` concerns, noted here only because a paused build resumes on that event (5.6.2).

## 5.7 Streaming pipeline

### 5.7.1 From callbacks to typed events

The run pipeline exposes one internal callback interface; `events/` owns delivery (SSE mechanics per ch03 3.6: monotonic ids, Last-Event-ID replay from a bounded ring of 200 events swept after 300 s idle, 30 s keepalive):

| Internal callback | Wire event (shared/events.ts) | Notes |
|---|---|---|
| onText | `text_chunk { text }` | one field name; the three legacy chunk names are normalized (reference/frontend-cleanup-audit.md FC-031) |
| onThinking | `thinking_chunk { text }` | chat stream only (2026-07-10 post-rc DECISION). Working commentary classified at the llm/ transport: extended-thinking blocks + the text of any turn that also carries tool_use (the SDK only continues past a turn through tool use, so the answer is exactly the toolless final turn's text). Marker-filtered with its own hold-back processor AND engine-identity-redacted (agents/branding.ts) before emission — the ch12 persona governs answers, not thinking. Never enters `complete.result` or the persisted answer; rides assistant-message metadata (`thinking`, `thinkingDurationMs`) for reload replay. Action markers found in commentary are stripped but never trigger delegation; a `<ekoa-context>` block in commentary still persists (answer-channel blocks win as "last"). |
| onToolEvent | `tool_event { phase, tool, args?, result?, isError?, durationMs? }` | result text truncated to 200 chars (carried) |
| onContextEvent | `context_event { name, action }` | agent-context content loaded/used |
| onPlanStep | `plan_step { status, description?, detail? }` | job streams only; absorbs retired phase information (P-11) |
| onSessionId | (none) | internal: sdkSessionId persistence (5.4.5) |
| onUsageDelta | (none) | internal: billing capture only; the provisional `usage_progress` tick is not carried to the wire (5.9.2) |
| onComplete | `complete { ... }` | terminal, dual-fire guarded (5.3.4) |
| onError | `error { code, message }` | terminal, sanitized at the egress chokepoint (FIXED-8; ch09) |

Every event payload is a zod-typed member of the per-stream union in `shared/events.ts`, derived from actual consumers (reference/frontend-cleanup-audit.md section 1.2). The four SSE endpoints of ch03 3.6 are the only delivery surfaces (FIXED-2).

### 5.7.2 Delegation as first-class typed events

The model signals handoffs in-band - that necessity remains, because the signal originates inside generated text. The rebuild keeps the in-band markers as a **prompt-side contract** (the marker vocabulary ships with the agent context, ch08) and moves ALL parsing server-side into the run pipeline (carried machinery: buffered start-of-stream detection for the build marker, regex strip for the integration marker, and a tail hold-back of marker-length-minus-one characters so a tag split across chunks never leaks - reference/invisible-behaviors.md section 7.1). What crosses the API is only typed events (reference/frontend-cleanup-audit.md FC-205):

- Build handoff: `build_intent { sessionId, sourceRunId, request }` on the notifications channel, plus `complete.delegate` on the originating chat-run stream (ch03 3.6.1, 3.6.4). The `template_id` enrichment fires only for onboarding sessions with a decided starting point (carried, section 7.1).
- Integration-builder handoff: `integration_build_intent { sessionId, hint? }`, same pattern.
- Context blocks (`<ekoa-context>`) are parsed and persisted server-side, never streamed.

No prose marker, partial or whole, may ever appear in a `text_chunk` OR `thinking_chunk` payload - that is a contract-test assertion (chapter 13).

### 5.7.3 RESOLVED (P-11) - drop subagent_event, fold phase events

Neither `subagent_event` nor `phase_changed` appears in the v1 wire contract. Both are dead on the wire today - emitted server-side, never registered by any client (reference/invisible-behaviors.md sections 7.1 and 7.4; reference/frontend-cleanup-audit.md FC-007). Sub-task notifications from the SDK are consumed internally (they reset the inactivity timer, 5.3.6) but not forwarded; phase information folds into `plan_step` on job streams and into the session resource for guided-build state.

Q-04 (ch16) - the question behind these events, missing-registration bug or abandoned feature - is resolved **delete on both sides**: the server-side producers and the never-written client handlers both go, executing P-11's drop branch. Nothing is registered and no client consumption is built.

Rejected alternative: register both as typed events and build the client consumption that never existed - deferrable and additive if ever wanted, but not built now.

Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 5.8 RESOLVED (P-12) - memory system scope in v1 (re-resolved 2026-07-06, Amendment 2)

Memory CRUD (ch03 3.8.19) and resolver injection (5.5.2) ship on, unchanged. **Automatic extraction ships ON** (re-resolved by Amendment 2). It runs **asynchronously post-run**, so it never adds turn latency; it is **batched per run** (one FAST-tier call per run, never per turn); and it is attributed **`user_work` `memory-extract`** billed to the run's user (ch06 6.4.1 row A1). It applies to **hosted agent runs only** - chat, build, and assistant replies; delegated local work is mined solely from derived output already present in the hosted record, so invariant I2 is preserved and no raw local content is ever extracted (5.4.8). Every extraction always writes **`visibility: 'private'`** - sharedness is never inferred (Part 4). Every automatic write is visible: a Registo entry plus a UI affordance (ch12). The per-user toggle is `memory.autoExtract` (default ON); the platform kill switch is `MEMORY_AUTO_EXTRACT_ENABLED` (5.4.7, default `true`). The privacy-scrub patterns are kept and consolidation stays deterministic code (no model call).

Previous resolution (superseded): automatic extraction shipped **off by default** behind the config flag, its fate in the call-site map recorded as "dropped from the platform baseline" (reference/llm-usage-map.md section 7, call 23; reference/invisible-behaviors.md section 11.2), on the rationale that a background per-turn model call was not user-requested work. Amendment 2 re-resolves that: extraction returns as correctly-attributed billable user work, asynchronous and batched per run, so it is neither ambient platform overhead nor turn latency - the zero-platform-calls posture of chapter 06 stands untouched because the call re-enters with a billee (ch06 call 23 re-fated).

Re-resolved: auto-extract ON, correctly attributed `user_work`, founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md). Original resolution retained as history: ACCEPT (off by default), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

Independent of the extraction toggle, the three deterministic memory writers - no model call in any of them (reference/invisible-behaviors.md section 11.6) - are **carried**, in scope under RESOLVED (P-12):

1. **Integration affinity.** On integration creation, configuration update, and re-enable, `integrations/` (ch02) writes or refreshes, through `memory/`'s writer, one idempotent shared `preference` memory keyed by the tag `integration-affinity:<key>` ("Prefer X for tasks Y... trigger keywords..."), score 85, `verified: true`, active tier. Re-enabling refreshes the timestamps of the existing row instead of duplicating it; write failures are swallowed - the memory is advisory and must never fail the configuration operation. This writer is the mechanism by which agents learn to prefer a connected integration; dropping it would silently change agent behavior, so it is carried, not dropped.
2. **Automation user-correction.** Step feedback may write a correction memory and evicts fingerprint-matched cache entries (5.6.7).
3. **Boot-time migration and idempotent seeding.** Owned by `memory/` (ch02); the seed data carries per ch08 8.6 row 7.

## 5.9 Dropped behaviors (explicit, with reasons)

### 5.9.1 Dropped from the run pipelines

| Behavior | Reason |
|---|---|
| Post-turn memory auto-extraction (chat, build, assistant) | **Superseded by Amendment 2 - no longer dropped:** returns ON as asynchronous post-run `user_work` `memory-extract`, batched per run, billed to the run's user (5.8; ch06 6.4.1 row A1, call 23 re-fated) |
| Assistant-reply memory co-op flag | **Superseded by Amendment 2:** assistant replies are one of the hosted run classes now mined by the returned post-run extraction (5.8); no separate co-op flag survives |
| Model-based slug generation post-build | fate "becomes-code": the deterministic fallback plus collision resolution is the only path (reference/llm-usage-map.md section 7 call 25) |
| Visual-vibe screenshot analysis in brand research | fate "dropped": unbilled, router-bypassing, non-fatal by design (reference/llm-usage-map.md section 7 call 26; ch06) |
| Router `escalate()` / `previousFailures` path | dead export, zero callers; the documented auto-escalation never existed (reference/llm-usage-map.md Conflicts 6) |
| Thinking budgets in tier configs | dead on the wire; effort is the only knob sent (reference/llm-usage-map.md Conflicts 5; ch06 records the conflict) |
| Expert-tier default for router-less calls | latent cost hazard; every run in the rebuild carries an explicit routing decision (reference/llm-usage-map.md Conflicts 13) |
| Legacy integration-suggestion call (`infer-integrations`) | no caller (ch03 Appendix A) |
| Build-time OAuth/tool validation harness | dev harness, never a serving path (reference/llm-usage-map.md section 4 row 27) |

### 5.9.2 Dropped from the wire (owned jointly with ch03)

| Behavior | Reason |
|---|---|
| `subagent_event`, `phase_changed` | RESOLVED (P-11): dead on the wire today; folded per 5.7.3; Q-04 resolved delete-on-both-sides (ch16) |
| `usage_progress` provisional token ticks | cosmetic; internal usage capture stays for billing, the debounced SSE tick does not (ch03 P-13) |
| Client-minted trace ids | server-minted run/job ids (ch03 3.4); duplicate protection preserved via 5.3.3 |
| Job `streamUrl` field | client derives the events URL from the id (ch03 3.8.8) |
| Chat `mode` routing enum and the client-side fallback classifier | routing is server-side through the tier classifier (FIXED-3; ch03 Appendix A) |
| Raw marker text in streams | 5.7.2: markers are a server-side prompt contract, never wire traffic |

Not dropped, easy to mistake for droppable: the marker machinery itself (the model still signals in-band - 5.7.2); the in-build answer flow (user_work, stays - reference/llm-usage-map.md section 5 rows 12-13); the six classifier call sites with deterministic fallbacks (reference/llm-usage-map.md section 6); the resolver write-on-read side effect (carried consciously, 5.5.2); cancelled-run billing semantics, which are neither carried nor dropped in this chapter but owned by RESOLVED (P-19) (ch06 6.9; see 5.6.5).

## 5.10 Acceptance criteria (checkable without a human)

1. Every guard in 5.3 has at least one automated test asserting the specified behavior: cancel idempotency and set-before-abort ordering; the aborted-classifier bail (a simulated Stop during classification results in zero jobs created); the 45-minute reservation returning the existing job; the dual-fire guard (second finalize is a no-op); the 409 on concurrent follow-up; timer semantics distinguishing timeout from Stop; provider-error-as-result producing `failed`, never `completed`, and never a persisted transcript turn.
2. P-10: killing the process mid-build and rebooting leaves the job `failed { code: 'ORPHANED' }` and the artifact `draft`; `GET /chat/runs/:id` for a pre-crash chat run returns 404.
3. SDK environment test: the spawned subprocess env contains **exactly the configured mode's credential and never an inherited one** - in `oauth` mode it contains `CLAUDE_CODE_OAUTH_TOKEN` and not `ANTHROPIC_API_KEY`; in `api-key` mode it contains `ANTHROPIC_API_KEY` (from central custody) and not `CLAUDE_CODE_OAUTH_TOKEN`; in both modes any inherited `ANTHROPIC_API_KEY`/`ANTH_API_KEY` is scrubbed before injection, `CLAUDECODE` is absent, and `ANTHROPIC_BASE_URL` is the internal chokepoint address (FIXED-13, 5.4.1) rather than any user or provider value; `settingSources` is empty; build runs get `HOME = projectDir`.
4. Session resume test: a follow-up build resumes with the stored `sdkSessionId` in the artifact's `projectDir`; a changed session id is persisted, an unchanged one is not rewritten.
5. Chat-run tool surface test: a chat run's allowed tools are exactly the two knowledge tools; a build run's include the coding preset (lint/contract check against 5.4.4).
6. Streaming contract tests: every event emitted on the four SSE endpoints validates against the `shared/events.ts` unions; no `text_chunk` or `thinking_chunk` payload ever contains a delegation-marker substring, including split-across-chunk cases (5.7.2); `subagent_event`, `phase_changed`, and `usage_progress` never appear on any stream.
7. Delegation test: a model output containing the build marker produces `build_intent` on the notifications channel and `complete.delegate` on the run stream, with clean text.
8. Artifact-backend lane tests carried from 5.6.6: queued-invocation-after-delete is refused; a post-settle capability RPC is rejected; a hung backend function times out and the next invocation on the same artifact succeeds on a fresh worker; dry-run captures effects without persisting them.
9. No model call executes in any lifecycle path of this chapter outside the `llm/` chokepoint (lint gate, FIXED-3), and no markdown is interpreted at runtime as logic (FIXED-4 - the guided-build state machine and all lifecycle decisions are TypeScript).
10. P-12 (re-resolved): with the per-user `memory.autoExtract` toggle **off**, a full chat turn and a full build complete with zero extraction model calls (assertable from the attribution ledger, ch06). With it **on** (the default), exactly one `memory-extract`-attributed `user_work` FAST call per run appears in the ledger, the resulting memory write carries `visibility: 'private'`, a Registo entry exists for it (ch12), and the run's terminal event fires without waiting on extraction (extraction is asynchronous post-run - 5.8).
11. Integration-affinity writer test (5.8): creating then updating an integration configuration for the same key leaves exactly one shared `preference` memory tagged `integration-affinity:<key>` with refreshed timestamps (no duplicate row); a forced memory-write failure does not fail the configuration operation; the attribution ledger records zero model calls for the write.
12. Delegation returns derived output only (5.4.8): a `delegate_to_local` result carries summaries, citations, patch proposals, and ledger references, and no raw local file body reaches the hosted context or any persisted transcript (contract test against the fake-daemon harness, chapter 18.7); with no daemon paired, `delegate_to_local` yields `409 DAEMON_NOT_CONNECTED` and uploads nothing.

Cross-references: diagram `spec/diagrams/04-agent-job` (FIXED-12); ch02 (module homes, injected seams); ch03 (endpoints, event unions, P-18); ch04 (jobs/automation_runs/memories collections, credential custody §4.5); ch06 (chokepoint, attribution, metering, tier table, credential custody); ch07 (build pipeline mechanics invoked from 5.6.2); ch08 (content loader behind 5.5.1); ch09 (egress sanitization, secret guard); ch17 (anonymisation pipeline behind the chokepoint egress per FIXED-13; per-conversation vault, 5.4.8); ch18 (the `delegate_to_local` contract and fake-daemon harness, 5.4.8); ch13 (tests named above); ch16 (Q-04).

---

**Amendment record.** Amended 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md): P-10, P-11 (with Q-04 resolved delete-on-both-sides), and P-12 resolved and folded normative; P-19 cross-references flipped to RESOLVED (sections 5.6.5, 5.9.2); the hosted `delegate_to_local` delegation tool added (section 5.4.8), derived-output-only with per-conversation vault propagation; and the SDK subprocess egress repointed at the `llm/` chokepoint per FIXED-13 (section 5.4.1).

Amended again 2026-07-06 per the consolidated-ledger amendment (Amendment 2, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md): FIXED-8 restated to two per-environment auth modes (subscription OAuth / Anthropic API key), with inherited provider env always scrubbed first and the configured mode's single credential injected from central custody (§5.4.1; acceptance criterion 3); the OAuth rotation machinery deleted and the warm-subprocess/auth-retry semantics simplified to one credential, proactive refresh, refresh-and-retry-once, and an alert on persistent failure (§5.4.2); the model-access asymmetry scoped to oauth mode only, with the conservative `completeFast` typing kept so the routing holds under both modes (§5.4.3); per-build verification inserted into the build-job completion sequence as `user_work` `build-verify` per Part 6 (§5.6.2); P-12 re-resolved so automatic memory extraction ships ON as asynchronous post-run `user_work` `memory-extract` billed to the run's user, with `MEMORY_AUTO_EXTRACT_ENABLED` default flipped to `true` behind the per-user `memory.autoExtract` toggle (§5.8, §5.4.7, §5.9.1, §5.6.2 step 8, §5.6.3, acceptance criterion 10); and `tenant` swept to `org` in live prose (§5.1).

*End of chapter 05.*
