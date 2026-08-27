# Token economics — follow-up build continuity

Ported from ekoa-dev's `docs/token-economics.md` (2026-08-27). File paths below are ekoa-code's.
Diagram: `docs/diagrams/04-agent-job.excalidraw` (routing + continuity note). Decision: see
`docs/decisions.md` (2026-08-27). Parity ledger row: `docs/dev-parity.md`.

## Symptom

A 5× Claude Max plan exhausted its 5-hour usage window after **4–5 prompts** on one long-lived
artifact (the ERP app), with no other users on the platform.

## Root cause — the transcript is the wrong continuity carrier

Follow-up builds resumed the Claude Agent SDK session: `agents/build.ts` passed `resume ←`
`resolveFollowUp().resumeSessionId ← artifact.data.sdkSessionId`. Four multipliers compounded on top:

1. **Unbounded transcript.** Every follow-up appended to the same SDK transcript — hundreds of
   thousands of tokens, mostly stale tool results (old file reads, esbuild output) that duplicate
   state already on disk and re-read fresh anyway.
2. **Compaction never fired.** The SDK auto-compacts only ~13k tokens below the context ceiling.
   ekoa-code's EXPERT tier is `claude-opus-5`, whose context window is **1M by default** (there is
   no `[1m]` marker here — unlike ekoa-dev's `claude-opus-4-8[1m]`). Threshold ≈ 987k tokens: in
   practice, never.
3. **Prompt cache dead between prompts.** Cortex rebuilds the system prompt every prompt (history,
   memories, live integration data); it sits before the transcript in the cached prefix, so one
   changed byte re-writes the whole transcript as cache *creation* at ~1.25× weight, and the cache
   TTL expires at human pace anyway. Within one run caching works; the damage is per-prompt.
4. **Opus for everything.** Follow-ups floored at EXPERT (Opus) — including "change this label".
   Opus weighs ~5× Sonnet against the usage window.

Arithmetic: one prompt on a ~300k-token transcript ≈ 300k × 1.25 (first-request cache write) +
N internal turns × 300k × 0.1 (cache reads) ≈ **~1M Opus-weighted tokens per prompt**; five prompts
≈ the whole window.

## Design — fresh sessions + cheap continuity carriers

**The project files on disk are the real state; the transcript is mostly stale copies of them.**
Every build prompt now runs a **fresh SDK session** (no `resume`). Continuity comes from four cheap
carriers:

| Carrier | Cost per prompt | Preserves |
|---|---|---|
| Project files on disk | task-dependent | ground truth of the code |
| Running summary `data.buildSummary` | ~1–2k tok | decisions, business rules, recent changes, corrections |
| Verbatim tail (6 msgs / 24k chars) | ≤ ~6k tok | "the user just said X" precision + recent pastes |
| Agent-maintained `NOTES.md` | on demand | durable engineering decisions, gotchas |

The running summary is a **fire-and-forget FAST (Haiku) pass** after each *successful* build —
`previous summary + user request + final reply + files changed → ≤600-word summary` (hard cap 6k
chars) stored on the artifact record. Same pattern as the post-run memory extractor (§5.8): one
`llm.runOneShot`, attributed `user_work` `build-summary`, billed to the build's user. Never blocks
the flow, never fails a build.

## Change map (ekoa-code)

| Concern | File(s) |
|---|---|
| Stop resuming on follow-ups (fresh session, no `resume`) | `api/src/agents/build.ts`; `api/src/apps/build-mechanics.ts` (`resolveFollowUp` returns `buildSummary`, not `resumeSessionId`); `api/src/agents/seams.ts` (`FollowUpResolution`, `persistBuildSummary` replaces `persistSdkSessionId`) |
| Running-summary service | `api/src/agents/build-summary.ts` (`scheduleBuildSummary`, `awaitPendingBuildSummary`); agent-type `build-summary` in `api/src/llm/attribution.ts` |
| Inject summary + shrink tail on follow-ups | `api/src/agents/build.ts` ("Prior Work On This App" + `capHistory` 6/24k with a summary, legacy 16/48k without) |
| Sonnet (WORKHORSE) floor for follow-ups | `api/src/agents/build.ts` (`routingFloor`); `api/src/llm/router.ts` (PT-PT big-change verbs escalate, triviality markers demote) |
| Auto-compact guardrail | `api/src/config.ts` (`buildAutoCompactWindowTokens` 200k, `buildAutoCompactPctOverride` 60); `api/src/llm/credentials.ts` (`buildSubprocessEnv`); `api/src/llm/client.ts` (`AgentRunOptions.autoCompact`) |
| NOTES.md carrier | `api/content/coding-agent/SKILL.md`; `api/src/apps/artifact-featured-update.ts` (exempt from the source-update sweep); bundle export already includes it (`artifact-bundle.ts` `collectFiles`) |
| Version restore clears the summary | `api/src/routes/artifacts.ts` |
| Reserved `data` keys (`buildSummary`, `buildSummaryUpdatedAt`) | `api/src/apps/artifacts-service.ts` |
| Deprecate `sdkSessionId` (stays reserved for legacy rows) | `shared/src/artifacts.ts` (doc); `artifacts-service.ts` (reserved) |

`[1m]` model drop (ekoa-dev item) is **N/A** here: ekoa-code is already on `claude-opus-5` with a 1M
default context (`config.ts`), no `[1m]` alias to remove.

## Tests

- `api/tests/agents/build-summary.test.ts` — service contract: seam write, empty/failed pass keeps
  the previous summary (never throws), input caps, forged-delimiter stripping.
- `api/tests/llm/router.test.ts` — WORKHORSE follow-up floor, PT escalation/demotion, classify reads
  the raw description.
- `api/tests/agents/build.test.ts` — routine follow-up floors at Sonnet with **no** `resume`; a
  big-change follow-up still escalates to Opus; completion schedules the summary through the seam.
- `api/tests/apps/build-mechanics.test.ts` — `resolveFollowUp` returns the summary; `persistBuildSummary`
  writes summary + stamp and ignores blanks.
- `api/tests/contract/artifact-family.test.ts` — restore clears the summary; a client PATCH cannot
  write `buildSummary`; `NOTES.md` survives a featured source-update while a non-scaffold file is swept.

## Deliberately not done

- **Stabilizing the system prompt for cross-prompt cache reads** — with a ~5-minute cache TTL and
  human-paced prompting the cache is dead between prompts anyway; not worth the prompt-shape risk.
- **Compact-between-prompts** — fresh sessions make it moot.
- **Resume behind a feature flag** — do NOT reintroduce `resume` on the build path; it silently
  recreates the whole problem as transcripts regrow.

## Verification caveat

The auto-compact env var names (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`)
are the ones ekoa-dev verified live against the installed Agent SDK. They are set on the build
subprocess env only; because follow-ups now run fresh sessions, this is a backstop for one runaway
build, not the main lever — even if a future SDK renames them, the fresh-session change stands on its
own. Confirm the compaction knobs are honored on the deployed SDK version before relying on them.
