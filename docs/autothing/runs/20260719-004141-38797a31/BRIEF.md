# Brief: Session Parallelism + Grounded Side-Questions

> Target: ekoa-code. Feed into Claude Code plan mode. Suggestive brief - structural
> decisions belong to the planning session; this document sets goals, constraints,
> and decision criteria.

## Goal

Ekoa must support several sessions working at the same time for a single user:
multiple build jobs running in parallel, multiple chats in parallel, and mixes of
both. On top of that, a "side question" mode: while a build or chat is running,
the user can ask questions grounded in that session's context without steering or
interrupting the main agent loop (analogous to Claude Code's btw feature).

## Current state (verify in plan mode, do not assume)

Known from architecture and code reading - confirm each before designing:

- Jobs already run async server-side. SSE is a single per-user stream; events carry
  `trace_id` and the client filters. Multiplexing is therefore structurally possible.
- A per-artifact concurrency guard already exists in `execute-handler`: a second
  build against the same artifact is rejected because two SDK resumes would corrupt
  the shared transcript file. This guard is correct and must stay.
- Job status model already includes `queued` alongside `running`.
- Frontend `orchestration` store keeps per-session job/preview/files state, but:
  - there is a global `isExecuting` flag,
  - `useJobStream` connects/disconnects per active session - background sessions
    likely drop events while not focused,
  - the store rehydrates job status on init, which papers over missed events.
- Each build spawns a Claude Agent SDK subprocess. N parallel builds = N
  subprocesses (CPU, memory, preview ports).
- Per-job billing gate and inactivity/wall-clock timeouts exist and are per-job,
  so they should compose under parallelism - verify no shared mutable state.

## Scope

### Workstream A - True parallel sessions

1. **Server**: confirm and harden that N jobs for one user run concurrently
   without shared-state races (job store writes, session context writes, billing
   accounting, trace store). Add a per-user parallel-execution cap; jobs beyond
   the cap enter `queued` and dispatch FIFO when a slot frees.
2. **Frontend**: move from "active session subscribes to its stream" to "one
   persistent event ingester routes every event to the owning session's state by
   trace_id/session, regardless of which session is focused." The UI renders
   whatever session is active from already-ingested state. Remove or scope the
   global `isExecuting` flag to per-session.
3. **Same-session double-send guard**: one in-flight request per session (chat)
   and the existing per-artifact guard (build). Parallelism is across sessions,
   never within one.

### Workstream B - Grounded side-questions ("btw" mode)

1. While a session has a running job (or an in-flight chat turn), the user can
   type a side question. It is answered by a separate, cheap model call - never
   injected into the running SDK loop.
2. Grounding context, lowest viable tier first: session message history + the
   job's streamed transcript so far + tool events + file-change list. No
   filesystem tools, no write access, read-only by construction.
3. Side answers render as a visually distinct thread (ephemeral or foldable),
   not interleaved as normal assistant messages - they must not pollute the
   session history that future turns resume from. Decide in planning whether
   they persist at all (criteria below).
4. Distinguish clearly in UX between:
   - **side question** - answered now, does not touch the main run;
   - **follow-up instruction** - queued, applied when the current run finishes
     (existing follow-up build path).

### Workstream C - Multi-session awareness UX

1. Session list shows live status per session (running / queued / done / failed)
   without opening it.
2. Completion/failure of a background session surfaces a non-blocking
   notification with a jump-to-session action.
3. PT-PT copy for all user-facing strings.

## Non-goals

- No external job-queue infrastructure (Redis, BullMQ, workers). In-process FIFO
  with persisted `queued` status is the ceiling for this run.
- No parallelism within a single session/artifact.
- No change to the SDK resume/transcript model.
- Side-questions do not get sandbox filesystem access in v1.

## Decision points (resolve in planning, with criteria)

1. **Per-user parallel cap value.** Criteria: SDK subprocess memory footprint
   measured on the live stack, typical build duration, single-host deployment.
   Start conservative (2-3); make it config, not code.
2. **Queue vs. reject beyond cap.** Prefer queue (status exists already) unless
   dispatch bookkeeping adds real complexity; rejection with a clear PT-PT
   message is an acceptable v1 fallback.
3. **Side-question persistence.** Persist if it costs one field on the message
   record; drop if it requires a parallel storage path. Never feed side Q&A back
   into the main loop's context.
4. **Side-question model tier.** Route through the existing router with a low
   ceiling; escalate only if grounding quality is demonstrably poor on real
   transcripts.
5. **Transcript access for grounding.** The streamed trace already exists
   per-job - reuse it. Only build a new grounding snapshot mechanism if the
   trace proves insufficient in practice.

## Exploration tasks for plan mode

- Map every server-side singleton or module-level mutable structure touched by a
  job run; classify each as safe / needs per-session scoping / needs a lock.
- Trace the frontend event path end-to-end and list every place that assumes a
  single active stream.
- Measure memory of one idle + one active SDK subprocess to inform the cap.
- Check preview port allocation under multiple simultaneous previews.
- Verify billing accumulation is correct when two jobs for the same user finish
  concurrently.

## Proof gates

- Two builds in two sessions run to completion simultaneously; each session's
  output, files, and preview are correct and never cross-contaminate.
- A chat turn completes in session A while a build streams in session B.
- Side question asked mid-build returns a grounded answer citing actual build
  activity; the build's final result is byte-identical to a run without the
  side question.
- Kill/refresh browser mid-parallel-run: both sessions rehydrate to correct
  status.
- Exceeding the cap produces the designed queue/reject behavior, in PT-PT.

## Risks

- Hidden shared state in session context or trace stores surfacing as
  cross-session bleed - the exploration map is the mitigation.
- Cost amplification: parallel builds multiply token burn; the existing per-job
  billing gate must be verified per-dispatch, not per-submission.
- Over-engineering pull: this does not need a job-queue framework, worker
  processes, or a scheduler abstraction. Flag and reject any plan that
  introduces one.
