# Decision memo - Part B structural decisions A-F (bound in FLOW_PLAN; evidence here)

Run `20260717-190134-9d4c1cbf`, slice A5. Decide-and-document per BRIEF §3. Choices are bound in
FLOW_PLAN "Structural decisions"; this memo records the criteria trace (BRIEF §4) and the A2
evidence (`analysis/06-chat-inventory.md`, every claim cited file:line there), including the A2
corrections that adjust how each decision lands.

## A. Panel host shape

**Choice:** discriminated-union `panelContent` extending the EXISTING orchestration store
(`web/stores/orchestration.ts`). No new Zustand store, no view registry.
**Criteria trace (BRIEF §4.A):** sheet feed + build views coexist per session without per-mode
special-casing (the store already keys everything per session - `sessionJobs`/`sessionPreviews`/
`sessionSidePanelStates`, 06 §3); a future content type touches one union member; "no new store if
extending the orchestration store suffices" is satisfied literally.
**Evidence:** the precedent already exists twice - `sidePanelState: 'none'|'build'|'integrate'`
(orchestration.ts:137, :204) with per-session copies (:206), and `ActiveIntegrationBuild`
(:144-153) as per-session panel payload; SidePanel's integrate early-return
(side-panel.tsx:405-411) is the whole-panel content-swap pattern the host generalizes. Lowest tier
that meets the criteria.

## B. Sheet <-> message data model

**Choice:** sheets persisted on the session record as subdocuments
`{sheetId, title, revisions[], createdFromMessageId}`; messages back-reference
`sheetId`/`revisionId` in `metadata`; old sessions render one-sheet-per-assistant-message at read
time - no backfill, no new collection.
**Criteria trace (BRIEF §4.B):** revisions survive reload - `messages` is NOT in the store's
`partialize` (orchestration.ts:1548-1571), transcripts always reload from the server, so
server-side sheets inherit reload-survival for free (06 §3). Canonical-context is one testable
function: `loadHistory` (`api/src/agents/context.ts:45-64`) is the single history assembly point;
the latest-revision-canonical rule lands there or as a named sibling (06 §4). Near-zero migration:
the read-time fallback needs no data change.
**A2 correction folded in:** `memoriesUsed`/`traceId` are typed on `ChatMessage.metadata`
(orchestration.ts:28, :34) and rendered when present (chat-panel.tsx:846-852) but NO writer exists
anywhere (06 §4) - BRIEF locked decision 10's provenance footer is true of the type, false of the
data. **B1 adds the writers** (e.g. `traceId = runId`, count from `resolveMemoryInjection`,
`api/src/memory/resolver.ts:113`) alongside the sheet metadata, or the footer renders empty.

## C. Revision storage

**Choice:** plain revision array on the sheet record. VersionsPanel/artifact versioning NOT reused.
**Criteria trace (BRIEF §4.C):** reuse only if it genuinely reduces code - it does not:
`versions-panel.tsx` is git-sha-shaped (`sha.slice(0,7)`, :189), keyed by `artifactId` only, and
lists/restores through artifact endpoints (06 §2). Forcing sheets through artifact-instance
machinery adds mapping code for symmetry's sake - exactly what §4.C forbids.

## D. Continue-vs-new classification

**Choice:** local heuristic only (imperative edit verbs + no new subject -> keep chip; explicit
new-topic markers -> clear). FAST-tier call only if the heuristic later proves insufficient.
**Criteria trace (BRIEF §4.D):** chip state set before/as the message sends (pure client-side
check, zero latency); wrong defaults tolerable because the chip is visible and overridable
(locked decision 6) - no gold-plating.
**A2 corrections folded in:** `classifyLocalFallback` and "conversation-types" (the BRIEF's
extension targets) DO NOT EXIST in this repo (06 §4) - what exists is server-side, build-flow
`classifyInBuildIntent`/`detectBuildIntent` (`api/src/agents/guided-build.ts:34-67`), a pattern to
imitate (deterministic fallback), not a base to extend. The heuristic is greenfield client code.
And there are TWO composers (06 §1): the chip lands only in ChatPanel's composer
(chat-panel.tsx:462-560); the empty-state composer in page.tsx:1573-1687 stays chip-free (blank
state has no sheets, consistent with F below).

## E. Summary event contract

**Choice:** SSE `reply_summary {sheetId, revisionId, title, summary}`; FAST-tier post-run hook
beside memory extraction; revision turns summarize the edit instruction/diff, not the whole reply;
degrade to the reply's first line on failure.
**Criteria trace (BRIEF §4.E):** graceful degradation is the extraction template's best-effort
catch pattern (`api/src/memory/extraction.ts:106-109`); the hook site has `runId`/`sessionId`/
`cleanText` in hand (`scheduleExtraction`, `api/src/agents/chat.ts:345-355`, fired after the
terminal event at :278) (06 §5). "Haiku" = FAST tier (`api/src/config.ts:104`); models are never
named outside config (06 §4).
**A2 correction folded in (changes the transport):** the client tears down the run EventSource the
moment `complete` arrives (page.tsx:1002-1014) and chat-run streams are per-run, in-memory,
ephemeral (routes/chat.ts:6-7) - a post-run `reply_summary` on the run SSE would be emitted into a
replay ring nobody reads. **`reply_summary` rides the per-user notifications channel**, the
`chat_answer` pattern (`api/src/agents/streaming.ts:143-146`; client listener with `sessionId`
routing, page.tsx:795-819) - NOT the run SSE. Lowest tier, and it survives the user having
navigated away (06 §7-B2).

## F. Blank-conversation transition

**Choice:** panel enters on FIRST SEND with a skeleton sheet; welcome/example cards exist only in
the blank full-width state.
**Criteria trace (BRIEF §4.F):** no layout jump while typing (the transition is tied to the send
action, not keystrokes or stream start); cards are not duplicated - they already live only in the
empty-state branch (page.tsx:1516-1707) and that branch simply never returns after first send.
**A2 corrections folded in:** there is NO AnimatePresence width morph to remove - the BRIEF's
locked decision 1 names a thing that does not exist. The layout switch is a plain conditional
className swap (page.tsx:1719-1724); `AnimatePresence, motion` is a dead import (page.tsx:5).
**B3 is additive**: drop the dead import, replace the visibility condition (the real one is the
`showSidePanel` expression at page.tsx:1214-1221 - `sessionHasPreview` also does not exist as an
identifier), and animate the panel entrance fresh (06 §1, §7-B3).
