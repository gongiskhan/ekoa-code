# Server-side map: multiple concurrent build jobs for one user (ekoa-code)

Finished. No `.codegraph/`; read the source directly. **Headline: there is NO per-user concurrency guard anywhere.** The only guards are per-SESSION (first build) and per-ARTIFACT (follow-up). Jobs run immediately in-process — no queue, no `queued` status (explicit "FIXED-8" invariant). Job record persists in MongoDB; live-run coordination is in-memory single-process.

## 1. Build-job execution path
- Submit: `POST /api/v1/jobs` — `api/src/routes/jobs.ts:37-84`; returns 202 then calls `result.fire()` (line 83) → fire-and-forget execution.
- Create dispatch: `handleBuildCreate` — `api/src/agents/build.ts:90-92` → `handleFirstBuild` / `handleFollowUp`.
- Execute-handler: `executeBuildJob` — `api/src/agents/build.ts:258-687`.
- **Per-artifact guard (quoted, build.ts:153-158):**
```ts
// One follow-up build per artifact (§5.3.5): reject a concurrent build targeting the same
// artifact — two would resume the same SDK transcript and corrupt it.
if (hasLiveJobForArtifact(artifactId) || (await nonTerminalJobForArtifact(artifactId))) {
  return { status: 'conflict' };  // → route returns 409 DUPLICATE_BUILD (routes/jobs.ts:80)
}
```
  Backing: in-memory `hasLiveJobForArtifact` (`agents/registry.ts:124-129`) + persisted Mongo query `nonTerminalJobForArtifact` (`agents/jobs.ts:117-120`). Artifact-scoped only.
- First-build guard is **session-scoped**: `reserveFirstBuild(sessionId)` (`build.ts:96-108`, `registry.ts:168-175`) — different sessions for one user both proceed.
- SDK subprocess spawn: `runAgent` (`build.ts:421-449`) → chokepoint `api/src/llm/client.ts:713-858`; actual `query({...})` spawn at `client.ts:407` (only file importing `@anthropic-ai/claude-agent-sdk`).
- ANTHROPIC_BASE_URL: `buildSubprocessEnv` (`api/src/llm/credentials.ts:368-455`) scrubs inherited provider env (`SCRUBBED_PROVIDER_ENV`, incl. ANTHROPIC_BASE_URL, lines 30-42) then sets `env.ANTHROPIC_BASE_URL = cfg.llmChokepointBaseUrl` (line 395); default `http://127.0.0.1:4111/api/v1/llm` (`config.ts:189`). Per-spawn, stateless.

## 2. Job status model
`api/src/agents/jobs.ts:14`: `'created' | 'running' | 'completed' | 'failed' | 'cancelled'`. **No `queued`.** Terminal = {completed,failed,cancelled} (`jobs.ts:18`). Shared contract types status as `z.string()` (`shared/src/jobs.ts:11`), enum enforced only server-side. Writers: `persistJob` (create) `build.ts:141,212`; `patchJob` transitions at `build.ts:298`(running),275(finishError),308(BILLING_BLOCKED),337(EDIT_FORBIDDEN),510(BUILD_UNFULFILLED),606(VERIFY_FAILED),622(completed),673(cancelled),642(PIPELINE_STUCK); boot `sweepOrphans`→failed{ORPHANED} `jobs.ts:137-142`. Every terminal transition guarded by `finalizeOnce(jobId)` (`registry.ts:116-121`).

## 3. Job store + in-memory structures a run touches
Job store = Mongo `jobs = new Store<Doc>('jobs')` (`data/stores.ts:134`; CAS-on-`_rev`, `data/store.ts:20-84`). Per-`_id`, safe. In-memory (single-process) structures + one-user-concurrent-jobs contention:
- `runs` Map (`registry.ts:42`) — keyed by **jobId** → disjoint. Scanned by artifact for the 409.
- `reservations` Map (`registry.ts:159`) — keyed by **sessionId** → contend only if same session.
- SSE `clients`/`rings`/`seq` (`events/sse-manager.ts:26-28`) — job rings keyed by **jobId** → disjoint; `seq` shared monotonic counter, no correctness issue.
- **`RateLimiter.userWindows/orgWindows/keyWindows/alerted` (`billing/rate-caps.ts:75-78`) — keyed by billeeUserId → YES, deliberate shared per-user accumulator (see §5).**
- `AppBuilder.contexts` (`apps/builder.ts:333`, keyed artifactId), `AppRegistry.apps/watchers` (`app-registry.ts:36-38`, artifactId), `staticHandlerCache` (`serving.ts:233`, distDir), `appHealthLastSeen` (`serving.ts:250`, appId), `withRepoLock chains` (`services/repo-lock.ts:12`, projectDir) — all disjoint per artifact.
Only genuinely shared across one user's concurrent builds: the per-user rate-cap window + the per-user notifications SSE ring.

## 4. SSE / event streaming
`events/sse-manager.ts` singleton. One stream per (stream,streamId) — job events use stream='job', streamId=**jobId** (`agents/streaming.ts:89-90`), so concurrent jobs don't share a job stream. Routing is by streamId in the ring key (`sse-manager.ts:30-32`), not a trace_id in the payload. Replay: per-key 200-event ring, Last-Event-ID replays id>lastEventId (`sse-manager.ts:9,43-45,61-67`); IDs globally monotonic. (Header claims a 300s idle sweep but no sweep code exists — rings only trimmed to 200.) The **notifications** channel IS per-user (streamId=userId): build_intent/chat_answer/usage_updated (`streaming.ts:131-162`, `server.ts:189-196`) — concurrent jobs interleave onto one ring. Ownership enforced pre-attach (`routes/jobs.ts:27-30`, 403).

## 5. Billing / metering
- Meter once per model call at chokepoint: `meter`→`recordTokenEvent` (`client.ts:850`, `billing/tracker.ts:180-242`) — one immutable `token_events` doc + CAS fold into `billing_accounts` with 10× outer retry (`casUpdateAccount`, `tracker.ts:116-127`, built for "many concurrent records on one account"). Concurrent jobs → CAS-serialized, no destructive race.
- **Billing gate is at DISPATCH/execution start, not submission**: `checkAllowance(userId)` at `build.ts:301` (after flipping running); def `billing/allowance.ts:38-63`. Pre-run admission ONLY, no mid-run kill (`allowance.ts:5-6`).
- Race: `checkAllowance` is a read with no reservation/decrement, so two concurrent jobs for one user can BOTH pass even if budget covers one; real spend reconciled later by CAS, can push past base into overage. Inherent to "pre-run only" design, amplified by parallelism.
- **Shared accumulator two concurrent jobs DO race on: in-memory rate/spend caps** (`billing/rate-caps.ts:72-184`), keyed billeeUserId (defaults 60 calls/60s, 5M metered tokens/60s, `rate-caps.ts:55-59`). check (`client.ts:740`) and recordSpend (`client.ts:851`) not atomic → transient burst overshoot. Tripped cap throws `LlmRateCapError` on the individual call (surfaces as ADAPTER_ERROR mid-job) — does NOT reject at submission.

## 6. Timeouts
**Per-job timers, not global** (`build.ts:281-295`): inactivity `setTimeout(onTimeout, buildInactivityTimeoutMs)` reset on every callback (default 300_000, `config.ts:131`); wall-clock `buildWallClockMs` absolute (default 2_400_000=40min, `config.ts:132`). `onTimeout` sets `entry.timedOut` + fires the run's own AbortController (`build.ts:290-294`); cleared in finally (`build.ts:663-666`). Each job has its own AbortController + entry → fully isolated. Verify stage has separate `verifyWallClockMs` (`config.ts:139`). Chat has one per-run `chatRunTimeoutMs` timer (`agents/chat.ts:104-107`).

## 7. Preview
**No per-session ports.** Previews served in-process at `/apps/:artifactId/` — `appUrl=/apps/${artifactId}/` (`build-mechanics.ts:157`); serving router `apps/serving.ts:297-429` resolves dist via appRegistry keyed by artifactId/slug. Project dir `<sandboxRoot>/user-<userId>/<appId>` (`app-paths.ts:57-59`). Two simultaneous previews DON'T collide — different artifacts → different appId/esbuild-context/distDir/URL. Same-artifact collision (shared projectDir + esbuild context) is exactly what the follow-up 409 prevents. Screenshot uses shared browser pool via `newContext()` per capture (`server.ts:428-431`), fire-and-forget.

## 8. Chat turn path — NO per-session in-flight guard
`POST /api/v1/chat/runs` (`routes/chat.ts:34-57`) → `createChatRun` (`agents/chat.ts:49-62`) mints a NEW runId per POST and registers; no per-session guard. Two concurrent chat POSTs same sessionId → both register (keyed runId), both persistUserMessage (`chat.ts:121`), both run. Chat does NOT pass `resume` to runAgent (`chat.ts:158-173`) so no SDK-transcript corruption, but interleaved CAS writes to the session. Build follow-up is the only run class with an anti-concurrency guard (per-artifact).

## 9. Config — where a per-user parallel cap goes
Central: `api/src/config.ts`. `loadAgentsConfig()` → `AgentsConfig` (`config.ts:39-66`, defaults 128-146, each env-overridable via `envInt`) is the natural home — add e.g. `maxConcurrentBuildsPerUser` = `envInt('MAX_CONCURRENT_BUILDS_PER_USER', N)`. (Rate-cap knobs alternatively in `rate-caps.ts:53-64`.) Enforcement point: `handleBuildCreate`/`handleFirstBuild`/`handleFollowUp` (`agents/build.ts`), backed by a new per-user counter over the existing `runs` Map (`registry.ts` already stores `ownerUserId`+`kind`) — e.g. a `liveBuildCountForUser(userId)` helper — returning a new refusal status the route maps to 429/409.

## 10. Any path rejecting a second concurrent job for the same USER?
**No.** First build = sessionId-keyed reservation; follow-up = artifactId-keyed 409; `liveRunCount()` (`registry.ts:199-201`) is test/introspection only (not a cap); only per-user limiter is the in-memory rate/spend cap, which throttles individual model calls mid-job (not submission). No global "one job at a time". A single user can run arbitrarily many concurrent build jobs across different sessions/artifacts plus concurrent chat runs, bounded only by per-user rate/spend caps and shared Mongo + in-process esbuild/serving resources. Adding a per-user parallel cap = adding the first submission-time per-user gate the system has.
