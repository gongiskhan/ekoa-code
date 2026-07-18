# Voice latency - first dashboard numbers (slice C7)

Run `20260717-190134-9d4c1cbf`, slice C7. BRIEF §5 Validation: "Latency instrumentation kept and
dashboarded: audio_in → first_interim → utterance_end → agent_first_token → tts_first_audio."
These are the FIRST real numbers off that pipeline, captured while proving the voice-proof e2e
against the credentialed boot-b stack (`node api/tests/journeys/boot-b.mjs up`).

**Label, up front: STUB, not vendor.** No Deepgram/Google/ElevenLabs key is present (C6 landed
`blocked`; see `slices/C6/gate-status.json`). Every number below except `agent_first_token` is
the STUB provider's timing (`api/src/voice/stub-providers.ts` - a hand-rolled fake with zero
artificial delay server-side). **`agent_first_token` is the one real leg**: the agent itself is
the credentialed live model (boot-b's own posture - same as `part-b-proof.spec.ts`), so that
number is genuine live-model latency, not a stub artifact. None of these numbers predict real
Deepgram/Google STT/TTS latency, round-trip network cost, or the C6 bake-off's provider pick -
that measurement is C6's job once vendor keys are provisioned.

## How the numbers were collected

Two collection points, both landed in this slice:

1. **Server-side** (`api/src/voice/session.ts`, C1, unchanged by C7): `SttTurnLatency` /
   `TtsTurnLatency` log ONE `voice.latency` JSON line per turn to the api process's own stdout.
2. **Client-side** (`web/lib/voice/latency-record.ts`, NEW in C7): `LatencyRecordCollector` folds
   the driver's per-mark stream (`session-driver.ts`'s `onLatencyMark` hook, C4) into ONE record
   per turn and logs it via `console.info({evt:'voice.client_latency_record', ...})` in
   `components/voice/use-voice-session.ts`. This is the FIRST time these marks have been
   collected into one record rather than five separate lines - the whole point of this slice's
   instrumentation work.

Both were exercised end-to-end by driving a real browser (mocked mic + a marker-frame WS
override + a deterministic VAD test factory - see `web/e2e/voice-proof.spec.ts`'s header) through
MANUAL and TALKING mode turns against boot-b, with the real credentialed agent replying.

## Server-side (stub provider, zero artificial delay) - representative lines

```
[voice.latency] {"kind":"stt_turn","turn":1,"ms_to_first_interim":0,"ms_to_utterance_end":0}
[voice.latency] {"kind":"tts_turn","lang":"pt-PT","ms_to_first_audio":2}
[voice.latency] {"kind":"tts_turn","lang":"pt-PT","ms_to_first_audio":1}
```

The stub's STT burst (`speech_started` → `transcript` interim → `transcript` final →
`utterance_end`) is emitted synchronously in response to one marker frame, so the SERVER-side
STT legs measure 0ms - there is no vendor round trip to measure yet. TTS's `say` → first audio
frame is 1-2ms server-side (the stub writes its WAV header immediately; the real inter-chunk
pacing, `INTER_CHUNK_DELAY_MS = 4`, only paces frames AFTER the first one, for barge-in
testability).

## Client-side (one record per turn, `LatencyRecordCollector`) - two real turns

| field | Turn A (talking, "Olá, bom dia.") | Turn B (talking, "Qual é o prazo do processo?") |
|---|---:|---:|
| `ms_to_first_interim` | 886 ms | 514 ms |
| `ms_to_utterance_end` | 886 ms | 516 ms |
| `ms_to_agent_first_token` | 12,678 ms | 33,396 ms |
| `ms_to_tts_first_audio` | 12,724 ms | 33,505 ms |
| (tts_first_audio − agent_first_token) | 46 ms | 109 ms |
| `interrupted` | false | false |

Raw record (Turn A):

```json
{"evt":"voice.client_latency_record","turn":0,"audio_in":7,"first_interim":893,
 "utterance_end":893,"agent_first_token":12685,"tts_first_audio":12731,"barge_in":null,
 "ms_to_first_interim":886,"ms_to_utterance_end":886,"ms_to_agent_first_token":12678,
 "ms_to_tts_first_audio":12724,"interrupted":false}
```

**Reading these:**

- **`ms_to_first_interim` / `ms_to_utterance_end` (~500-900ms client-perceived, vs. 0ms
  server-side):** the gap is network round-trip (browser → relay → stub → relay → browser, twice
  for interim then final) plus one React render cycle, not provider processing time - expected,
  and the number the CLIENT actually experiences is the product-relevant one for a "how snappy
  does this feel" dashboard, so both legs (server 0ms, client ~0.5-0.9s) are worth keeping side
  by side once a real vendor is in the loop.
- **`ms_to_agent_first_token` (12.7s and 33.4s):** genuine live-model latency for these two
  turns - the ONLY non-stub number here. Wide variance between two turns of the SAME agent on
  similar prompts is expected (tool calls, thinking depth); this is not yet a stable baseline,
  just the first observed samples. A related, already-tracked characteristic
  (`docs/findings.md` → `knowledge-tool-sync-io-stall`) means this leg can also delay UNRELATED
  connections on the same api process while it runs - observed directly during this slice's
  testing (a separate voice WS's marker-frame response was delayed 9-18s by a concurrent turn's
  tool-call work).
  - **`(tts_first_audio − agent_first_token)` (46ms, 109ms):** the TRUE "reply started, and it
  became audible" gap, which stays small and stub-fast regardless of how long the agent took to
  start replying - the number that will matter once TTS is a real vendor.
- **MANUAL mode produces no closed record at all in a one-turn session** (verified, not a bug):
  the collector closes a turn on `tts_first_audio` OR the next `audio_in`; manual mode never
  auto-speaks (BRIEF §5: "only on demand"), so nothing closes the turn until a SECOND capture
  opens or the session tears down (`LatencyRecordCollector.close()` covers exactly this at
  teardown). Manual mode's `first_interim`/`utterance_end` legs are still visible via the
  SERVER-side `voice.latency` STT lines even when the client never closes a record.

## Known instrumentation limitation (not fixed here, out of C7's scope)

Within ONE continuous TALKING-mode session, `audio_in` is emitted only ONCE, at the very first
tap (`voice-machine.ts` `onTapMic`) - a SECOND utterance later in the same hands-free loop (or a
barge-in-during-standby pending note) opens a fresh capture with NO new `audio_in` mark. The
collector folds whatever marks arrive, so in that scenario a "turn" record can end up mixing a
LATER utterance's `first_interim`/`utterance_end` with the ORIGINAL session's `audio_in`
reference - the deltas are still individually meaningful (each is `mark − audio_in`) but the
record as a whole no longer represents one clean utterance. Observed directly while testing the
STANDBY + pending-note scenario. A real per-utterance `audio_in` mark (or an explicit
"pending-note capture opened" mark) would close this gap; left for the v1.1 latency-dashboard
follow-up (BRIEF §5 open items ledger already tracks VAD-gated streaming and Flux endpointing as
v1.1 - this joins that list).

## What C6 still owes (unblocks the real numbers)

Once Deepgram/Google/ElevenLabs credentials land (C6, currently `blocked`), re-run this same
`voice-proof.spec.ts` collection and replace this memo's stub numbers with real vendor legs -
`ms_to_first_interim` and the TTS `ms_to_first_audio` should both grow from ~0-2ms (stub) to
real network+model round trips; `ms_to_agent_first_token` is unaffected (already real).
