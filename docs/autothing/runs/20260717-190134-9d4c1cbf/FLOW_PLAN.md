# FLOW_PLAN — Ekoa Mega Run (run 20260717-190134-9d4c1cbf)

Derives from `RUN_SPEC.md` (assumptions ledger governs). Profile: **build**. Branch: **`mega-run`**
off main (BRIEF §0: merge to main only after operator diff review — same posture as the operator
run); checkpoint commit + tag `mega/<sliceId>` per slice. Docs-kind slices run reduced gates
(deterministic wall + fresh-context review of the deliverable; e2e/design/walkthrough recorded as
kind-conditional skips). Journey suite (j0–j9) green at every checkpoint; J3 after anything touching
the build pipeline. Every api-behavior slice: contract test + suite-ledger registration same change;
diagram update when structure/flow/data changes. PT-PT lawyer-facing strings (o seu/a sua, ecrã,
por omissão, sem travessões); NO emoji in UI code. Restricted-vocabulary rule per BRIEF §0 holds in
all Parts A–D output; permission needs call the existing `can(capability)` layer (landed; no new
design discussion outside Part F). Part F: NOT planned this run (input file missing — human-action
list); becomes its own run per BRIEF §10 unless the file appears before E lands.

## Slice table

| id | title | kind | size | group | deps | status |
|---|---|---|---|---|---|---|
| A0 | run setup: mega-run branch, baseline journey suite green, run dirs | api | 2 | A | — | pending |
| A1 | refresh tracks 1–5: verify 20260712 analyses still true + browser-context topology + integrations→automations routing addendum | docs | 2 | A | A0 | pending |
| A2 | track 6: chat page inventory (SidePanel/session keying/morphs/welcome cards) | docs | 2 | A | A0 | pending |
| A3 | track 7: voice reuse verification (garrison fitting + jarvis branch shapes, exact paths) | docs | 2 | A | A0 | pending |
| A4 | track 8: portal connector audit (read-only; Citius first) + verdict table | docs | 3 | A | A0 | pending |
| A5 | decision memos: B structural A–F, C deviations, audit-event vocabulary, meter forecast | docs | 3 | A | A1,A2,A3,A4 | pending |
| B1 | sheets persistence + shared schema + canonical-context assembly (one unit-tested fn) + edit endpoints (who/when/what) | api | 5 | B | A2,A5 | pending |
| B2 | reply_summary post-run hook (FAST tier, diff-for-revisions) + SSE event + graceful degradation | api | 3 | B | B1 | pending |
| B3 | layout unification: rail+panel all modes, panel-host union in orchestration store, kill width morph, blank-state transition on first send | ui | 7 | B | A2,A5 | pending |
| B4 | sheet feed: desk surface, length-scaled typography, footer (provenance/actions/follow-ups, extensible for ouvir), auto-follow + scroll-to-highlight | ui | 5 | B | B3 | pending |
| B5 | summary cards (placeholder→final; revision cards focus sheet) + composer chip (local heuristic auto set/clear, dismiss) + in-place edit with revision nav | ui | 6 | B | B1,B2,B4 | pending |
| B6 | mobile FAB overlay = sheet feed + i18n sweep both locales | mixed | 3 | B | B4,B5 | pending |
| B7 | Part B proof e2e (Q&A short+long, 3-edit one-sheet, chip dismiss, build coexistence, reload restore) + summary-failure path + walkthrough | mixed | 4 | B | B5,B6 | pending |
| C1 | voice relay module: WS /api/voice/stream + /tts-stream (sibling of the streaming carve-out, diagrammed), org/user attribution, 10-min timeout, provider interface + stub providers, per-stage latency logging | api | 5 | C | B7 | pending |
| C2 | voice metering: voice_stt_ms + voice_tts_chars per-org counters (tracker) + activity events source:voice per A5 vocabulary + billing-truth extension | api | 3 | C | C1,A5 | pending |
| C3 | voice-machine reducer port (talking/manual) + graceWindowMs + confirmation gate + standby + pending note; Node unit tests zero mocks | ui | 4 | C | A3 | pending |
| C4 | capture chain: AudioWorklet port, pcm downsample 16k, vad-web gate, level meter, secure-context messaging, mic button + ouvir action | ui | 6 | C | B7,C3 | pending |
| C5 | TTS pipeline: sanitizer + normalizeNumbersPt/en + sentence chunking + per-language provider config (aura2-en/google-pt/elevenlabs-fallback) + AudioBufferSourceNode playback + barge-in clear | mixed | 5 | C | C1,C3 | pending |
| C6 | VENDOR-GATED: live Deepgram Nova-3 stream + keyterm dictionary (Mongo, deviation memo) + TTS bake-off (3 samples/candidate, STT round-trip, provisional pick, escalation rule) | mixed | 6 | C | C1,C5; keys | pending |
| C7 | voice proof e2e on unified page (stub vendors: manual + talking, standby + pending note through 2-min task, barge-in) + latency numbers in landing + walkthrough | mixed | 4 | C | C2,C4,C5 | pending |
| D1 | operator surface verification on today's main: operator e2e suites + J3 + drift report (fix drift in-slice) | api | 3 | D | A0 | pending |
| D2 | operator deltas per A5 vocabulary memo only (align app-action activity events with voice shape); collapses to a note if none | mixed | 2 | D | D1,A5 | pending |
| E1 | shared portal-document + portal-event records + dossiê receiving surface (verified at implement; lowest-tier attach) | api | 4 | E | A4 | pending |
| E2 | certidão comercial by access code: real client behind base-URL config, committed fixtures, parser → structured company record + document attach, PT-PT | api | 5 | E | E1 | pending |
| E3 | certidão predial + registo civil (same pattern; civil where available) | api | 4 | E | E2 | pending |
| E4 | insolvência watcher: polling via existing trigger/event infra, NIF/name watch per dossiê, event emit + render | mixed | 5 | E | E1 | pending |
| E5 | DGSI/DRE verify-only + Part E gate e2e (comercial certidão + watcher event rendering in one dossiê, fixtures) + walkthrough | mixed | 4 | E | E2,E4 | pending |

27 slices; sizes on the ~100-point whole-run scale; none > 8 (B3=7 is the max). Order:
A (A0 first, A1–A4 parallel, A5 last) → B → C (B7 gates C's UI slices; C3 may start after A3) →
D (D1 may run any time after A0; D2 after A5) → E (after A4; may interleave with C — it is the
meter shock absorber and drops whole if the forecast tightens). C6 is the only vendor-keyed slice:
it re-checks key presence at start and lands `blocked` with the exact missing item if absent —
never improvised. B always precedes C; A4 always precedes E1.

## Structural decisions (bound; A5 documents with evidence)

- **B.A panel host**: discriminated-union `panelContent` extension of the EXISTING orchestration
  store; no new store, no registry. — **B.B sheet model**: sheets persisted on the session record
  (subdocuments) with `{sheetId,title,revisions[],createdFromMessageId}`; messages back-reference
  `sheetId/revisionId` in metadata; old sessions render one-sheet-per-assistant-message at read
  time, no backfill. — **B.C revisions**: plain array on the sheet; artifact-versioning machinery
  NOT reused. — **B.D continue-vs-new**: local heuristic only (imperative edit verbs, no new
  subject → keep chip; new-topic markers → clear). — **B.E summary**: SSE `reply_summary
  {sheetId,revisionId,title,summary}`; FAST-tier post-run hook beside memory extraction; revision
  turns summarize the edit instruction/diff; degrade to first line. — **B.F blank transition**:
  panel enters on FIRST SEND with a skeleton sheet; welcome/example cards exist only in the blank
  full-width state. — **C WS placement**: a `voice/` module beside `streaming/` following its
  carve-out pattern (tier 3), documented in the diagrams as the second WS surface. — **C keyterm
  dictionary in Mongo** not Firestore (platform persistence; deviation memo). — **E records**:
  `PortalDocument {source,type,subjectIds,retrievedAt,fileRef,parsed?}` + `PortalEvent
  {source,kind,subjectRef,dossierRef,observedAt,payload}` in shared/; signed-in connectors later
  EXTEND these.

## Parallelism & shared runtime

Parallel-safe: {A1,A2,A3,A4}; {B1,B2} vs {B3,B4}; {C3 vs C1/C2}; {D1 with any}; {E2 vs E4}.
SERIALIZE: the dev stack (rebuild+restart+re-provision credential after api changes — see
.walkthrough/notes.md), any browser recorder, ALL codex exec calls run-wide. Cross-session: claim
each slice's files as agent-mail reservations before editing; release on pass/block. Subagent
caveat: this session's subagent notifications are unreliable (see RUN_LOG DECISION 20:30Z) —
prefer in-lead implementation with workflows only if subagent returns prove reliable again.

## Gate config

Profile **build** → codexSliceReview every slice; deliberateRed + mutation ON; docs-kind reduced
gates; api-kind batched adversarial-test at part boundaries; ui/mixed get design audit + walkthrough.
Turn cap: max(300, 80×27) = **2160** (sentinel updated; runaway brake, not a schedule).

## Critical files

- `web/src` chat page + orchestration store (A2 pins exact paths; B3–B6 modify).
- `api/src` sessions/messages persistence + `events/` SSE + `memory/` post-run hook (B1/B2).
- `api/src/billing/tracker.ts` + `shared/registo.ts` vocabulary (C2/D2).
- `~/dev/garrison` fittings/seed/deepgram-voice + origin/feat/local-voice-jarvis (C1/C3/C4 sources).
- `api/src/legal/citius.ts` + triggers/events queue (A4/E4).
