# Decision memo - Part C voice: deviations from BRIEF §5 defaults

Run `20260717-190134-9d4c1cbf`, slice A5. BRIEF §3 pre-loads Part C's decisions in §5 and allows
deviation only with evidence. Four deviations, all evidence-forced; **everything else in §5 stands
as written** (adaptive grace window with the given params, layered noise handling, TTS candidate
table with the Google prior + escalation rule, ungated v1 streaming behind full metering with
separate `voice_stt_ms`/`voice_tts_chars` counters, locale-only pt-PT/pt-BR resolution, barge-in
shipped in v1 talking mode, the full mobile/iOS checklist, standby + pending note).

## (i) The named jarvis artifacts DO NOT EXIST - C3/C4/C5 are new writes, seeded not ported

BRIEF §5 "Reuse (verified in Part A)" names `voice-machine.ts`, `voice-capture.ts`,
`graceWindowMs`, the ~300 ms confirmation gate, standby, `speakable-numbers-pt`, and an iOS kit.
A3 verified by full-tree listing + pickaxe over all garrison history (`analysis/07-voice-reuse.md`
§2): **no file, no symbol, no commit** - the BRIEF's citations are aspirational. Also stale: the
repo is `~/dev/garrison`, not "agent-garrison" (07 header; RUN_SPEC assumption 4; RUN_LOG GATE
2026-07-17T21:49:07Z).

Consequence (already bound into FLOW_PLAN C3/C4/C5): new writes guided by the BRIEF's design
decisions, seeded by the code that DOES exist:

- state machine: `legacy-voice.tsx:205-227` inline machine (state union + transition table) as
  behavioral reference - no reducer, no tests exist; C3 writes the pure reducer + Node tests new
  ("port the reducer unit tests" has no referent, 07 §2).
- standby seed: jarvis-os `pauseVad()`/`endTurnIfDone()` drain-then-re-arm
  (`feat/local-voice-jarvis:fittings/seed/jarvis-os/ui/main.tsx:239-268`).
- sanitizer seed: `toSpeakable()` (main.tsx:105-138) - strips markdown/code/URLs; no number
  normalization exists, `normalizeNumbersPt` is new (07 §4-C5).
- capture: resample math + native-rate rule + audio unlock from legacy-voice.tsx; the
  `ScriptProcessorNode` chain is REWRITTEN as the AudioWorklet downsample node (07 §4-C4).
- vad-web self-hosted asset recipe: `feat/local-voice-jarvis:fittings/seed/jarvis-os/ui/build.mjs:16-32`
  (worklet + onnx + ort WASM copied next to the bundle - matches the strict CSP posture).

## (ii) The fitting lacks /tts-stream, clear, and latency logging - C1 builds them

The deepgram-voice fitting has only `POST /stt`, `POST /tts`, `WS /stream` (07 §1). `git grep`
across every garrison ref for `tts-stream`: zero hits outside a trace asset. No `clear`/barge-in
command, no per-stage latency JSON logging (startup/shutdown console lines only). BRIEF §5 wrote
these as if present; they are design targets. C1 additionally adds what the fitting never had:
provider interface (Deepgram base URL hardcoded, server.mjs:33), org/user attribution, the 10-min
timeout. What DOES port nearly verbatim: the `attachStream()` live relay (server.mjs:206-290) and
the web-channel same-origin proxy patterns (07 §4-C1).

## (iii) Keyterm dictionary in the platform store, not a direct Firestore plane

BRIEF §5 says "per-user correction dictionary in Firestore". The platform's persistence is
Mongo-collection domain stores (`api/src/data/stores.ts:1-6`; Firestore Mongo-compat is the only
physical backend). The dictionary lands as an ordinary platform store - same tenancy, same
`Store<T>` plumbing, no second persistence plane or SDK. The BRIEF's intent (per-user, stateless
per-request injection, nothing crosses users) is unchanged; the deviation is API-level only. Bound
in FLOW_PLAN ("C keyterm dictionary in Mongo not Firestore"); RUN_SPEC assumption 6.

## (iv) Vendor keys absent at run start - C6 gated, never improvised

Preflight (RUN_LOG GATE 2026-07-17T19:09:55Z): no Deepgram key, no ElevenLabs key (optional -
absence recorded per BRIEF §1), no OpenRouter key, no gcloud ADC, and the BRIEF-named GCP project
is not visible on this machine. Per RUN_SPEC assumption 1 the run proceeds; C6 (the only
vendor-keyed slice) re-checks key presence when C opens and, if still absent, lands `blocked`
naming the exact missing item (FLOW_PLAN C6). Human-action list items 1-4 (RUN_LOG, minute zero)
are the operator's side; the multi-day window allows mid-run provisioning. The bake-off and the
live Nova-3 stream are the only casualties of a still-missing key - the rest of Part C runs on the
stub providers behind the same interface (C1/C5/C7).
