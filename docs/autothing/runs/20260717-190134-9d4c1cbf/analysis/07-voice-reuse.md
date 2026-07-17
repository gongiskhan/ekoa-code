# A3 — Voice reuse verification (garrison)

Verified in `/Users/ggomes/dev/garrison` (branch refs cited as `feat/local-voice-jarvis:<path>` = `origin/feat/local-voice-jarvis`; unprefixed paths = `main` working tree). The BRIEF's repo name "agent-garrison" is stale: `~/dev/agent-garrison` is an older repo with no voice work and no jarvis branch; `~/dev/garrison` is the source.

## 1. fittings/seed/deepgram-voice (main) — PRESENT

Files: `apm.yml`, `README.md`, `scripts/server.mjs` (401 lines), `scripts/connector.mjs`, `scripts/probe.mjs`, `scripts/start.mjs`.

Endpoints (`fittings/seed/deepgram-voice/scripts/server.mjs`):
- `GET /health` (+ `/api/health`) → `{ ok, port, pid, host, keyConfigured }` (server.mjs:59-67); `GET /` status HTML.
- `POST /stt` — raw audio bytes, `Content-Type` = recording mime, 25 MB cap → Deepgram batch `/v1/listen` (`smart_format`, `punctuate`) → `{ transcript, confidence }`; 503 JSON when key missing (server.mjs:106-148).
- `POST /tts` — `{ text, format: "mp3"|"wav" }`; wav = `linear16`/`container=wav`/`sample_rate=16000` → `/v1/speak` → audio bytes, `Cache-Control: no-store` (server.mjs:150-194).
- `WS /stream?sample_rate=<8000-48000, default 16000>&utterance_end_ms=<1000-20000, default 5000>` — relays client binary linear16 mono PCM to Deepgram live `/v1/listen` (`endpointing:300`, `interim_results`, `vad_events`, `punctuate`, `smart_format`); emits `{ready,sampleRate}` | `{speech_started}` | `{transcript,text,isFinal,speechFinal}` | `{utterance_end,transcript}` (accumulated finals) | `{error}`; client control msg `{type:"CloseStream"}`; buffers PCM arriving before the upstream opens (server.mjs:206-290).

ABSENT vs the brief's assumed shape: no `WS /tts-stream`, no `clear`/barge-in command, no per-stage latency JSON logging (only startup/shutdown console lines). `git grep -iE 'tts-stream|ttsStream'` across every ref in garrison: zero hits outside a Playwright trace asset. These are BRIEF design targets to build new, not code to port.

Vendor key: env `DEEPGRAM_API_KEY` (vault-injected by the runner per `apm.yml` `secret_scope` + `consumes: vault`; apm.yml:50-59). Model/port overrides: `DEEPGRAM_STT_MODEL` (nova-2), `DEEPGRAM_TTS_MODEL` (aura-asteria-en), `DEEPGRAM_VOICE_PORT` (7085) (server.mjs:35-51).

Quality/portability: plain `node:http` + `ws`, ESM, zero framework deps; solid error envelopes (400/502/503 JSON), body caps (25 MB audio / 1 MB JSON), sample-rate clamping; the `attachStream()` relay (server.mjs:206-290) ports nearly verbatim into a TS api module. Drop for ekoa: garrison status file (`~/.garrison/ui-fittings/deepgram-voice.json`), free-port scan, HTML status page, `connector.mjs` (garrison automation contract). Add for ekoa: TS types, auth/org+user attribution, latency logging, provider interface (Deepgram base URL is hardcoded at server.mjs:33).

## 2. origin/feat/local-voice-jarvis — what actually exists

`git ls-tree -r origin/feat/local-voice-jarvis --name-only` + pickaxe over all history (`git log --all -S` for each name): **`voice-machine.ts`, `voice-capture.ts`, `graceWindowMs`, the ~300 ms confirmation gate, standby mode, `speakable-numbers-pt`, and an iOS-specific kit DO NOT EXIST anywhere in garrison** — no file, no symbol, no commit. BRIEF items citing them (BRIEF.md:52, 114) are aspirational; the corresponding C slices are new writes guided by the BRIEF's design decisions (BRIEF.md:120-136), with the branch code below as behavioral reference.

What the branch does contain:
- `feat/local-voice-jarvis:fittings/seed/jarvis-os/ui/main.tsx` (677 lines) — the hands-free voice client. Mode machine `CoreMode = "idle"|"working"|"listening"|"speaking"|"error"` (`feat/local-voice-jarvis:fittings/seed/jarvis-os/ui/cores/DitherCore.tsx:21`) held in React state + refs; NOT a pure reducer, NO unit tests, effects interleaved with state. VAD: `@ricky0123/vad-web` `^0.0.30` (Silero via `onnxruntime-web` `^1.26.0`, WASM, fully in-browser; `feat/local-voice-jarvis:package.json`), `MicVAD.new` with default thresholds 0.3/0.25 (main.tsx:466-494). Turn-end/re-arm: `pauseVad()` on speechEnd and during TTS so the mic never captures its own speech; `endTurnIfDone()` re-arms only when send + speak queue fully drain (main.tsx:239-268) — the closest existing pattern to "standby". Capture: VAD's speech segment `Float32Array` → `float32ToWavBlob` 16 kHz 16-bit WAV → batch `POST /api/voice/stt` (main.tsx:32-46, 426-443) — NOT streaming linear16 over WS. TTS: `audio.src = /api/voice/tts?text=...` MediaElement + analyser, sentence queue via `enqueueSpeech` (main.tsx:296-310). `toSpeakable()` (main.tsx:105-138): strips markdown/code/emoji/URLs, caps at 700 chars on a sentence boundary with PT suffix "… o resto está no ecrã." — the seed of C5's sanitizer; no number normalization.
- `feat/local-voice-jarvis:fittings/seed/jarvis-os/ui/build.mjs:16-32` — the vad-web asset recipe: copy `vad.worklet.bundle.min.js`, `silero_vad_v5.onnx`, `silero_vad_legacy.onnx`, and every `ort-wasm*.{wasm,mjs}` next to the bundle; point `baseAssetPath`/`onnxWASMBasePath` at it. Direct source for C4 asset serving.
- `feat/local-voice-jarvis:fittings/seed/local-voice/` — fully local faster-whisper STT + Kokoro/Piper TTS (Python voice-server + Node wrapper, :7090), same voice contract as deepgram-voice; PT uses Piper `pt_PT-tugão`. Per BRIEF (line 114) the local models are NOT taken; its per-language TTS router (`piper_voices` lang→voice map, `apm.yml:40-41`) is the only prior art for C5's per-language provider config.
- `feat/local-voice-jarvis:docs/garrison-architect/jarvis-turn-latency-findings.md` — measured turn-latency findings (gateway/routing fixes, PT); background for C1's latency budget, no portable code.
- iOS handling exists as inline patterns, not a kit: gesture audio unlock via silent WAV under user activation (`fittings/seed/web-channel-default/ui/legacy-voice.tsx:32-46, 266`), `ctx.resume()` under user activation (`feat/local-voice-jarvis:fittings/seed/jarvis-os/ui/main.tsx:510`), capture at device-native rate because iOS ignores a requested 16 kHz (legacy-voice.tsx:320-341).
- deepgram-voice on the branch differs from main only in `apm.yml` metadata and lacks `connector.mjs` (added later on main); `scripts/server.mjs` is identical (`git diff --stat main origin/feat/local-voice-jarvis -- fittings/seed/deepgram-voice/`).

## 3. web-channel-default/ui/legacy-voice.tsx (main) — shape note

819 lines, one React `App()` with the whole voice client inline: typed state machine `"idle"|"arming"|"listening"|"speaking"` in `useState` + ref mirror (legacy-voice.tsx:205-227), no reducer, no tests. Streaming path: `getUserMedia` → `AudioContext` at native rate → **`ScriptProcessorNode`** (deprecated; not AudioWorklet) → linear-interpolation resample to 16 kHz Int16 → `WS /api/voice/stream?sample_rate=16000&utterance_end_ms=...` (legacy-voice.tsx:319-397). `MediaRecorder` batch fallback (`?voice=batch`, legacy-voice.tsx:22-24), secure-context gate `micCaptureAllowed()` (legacy-voice.tsx:71-78), mobile audio unlock + reused unlocked `Audio` element for read-aloud (legacy-voice.tsx:259-266, 446).

## 4. Part C port map

**C1 — voice relay module (api).**
- Port: `fittings/seed/deepgram-voice/scripts/server.mjs:206-290` (`attachStream` — the Deepgram live relay + event protocol) and the same-origin proxy patterns in `fittings/seed/web-channel-default/scripts/server.mjs:144-230` (`/api/voice/health` discovery probe, binary `/stt`/`/tts` proxy, `relayVoiceStream` pure WS passthrough with pre-open buffering).
- New (no garrison source): `WS /tts-stream` + `clear` barge-in command, per-stage latency JSON logging, org/user attribution, 10-min timeout, provider interface + stubs (garrison hardcodes `https://api.deepgram.com`, server.mjs:33).
- Dependency: `ws` `^8.18.0` (MIT; already conventional in Node servers). Key stays server-side as env — same posture ekoa needs, renamed/managed per ekoa config.

**C3 — voice-machine reducer (ui).**
- No reducer exists to port; write new. Behavioral references: legacy-voice.tsx:205-227, 609-620 (state union + transition table incl. arming cancel) and `feat/local-voice-jarvis:fittings/seed/jarvis-os/ui/main.tsx:239-268, 264-268` (pause/resume gating + drain-then-re-arm turn end — the standby seed).
- `graceWindowMs`, ~300 ms confirmation gate, standby, pending note: specified only in BRIEF.md:120-136; no prior code. Unit tests: none exist in garrison ("port the reducer unit tests", BRIEF.md:144, has no referent) — write new Node tests, zero mocks.

**C4 — capture chain (ui).**
- Port: resample math (legacy-voice.tsx:366, linear-interp to 16 kHz Int16), native-rate capture rule (legacy-voice.tsx:320-341), secure-context gate (legacy-voice.tsx:71-78), audio unlock (legacy-voice.tsx:32-46, 266), VAD integration (`feat/local-voice-jarvis:fittings/seed/jarvis-os/ui/main.tsx:458-496` — MicVAD options, stream reuse, pause/resume) and the asset-copy recipe (`feat/local-voice-jarvis:fittings/seed/jarvis-os/ui/build.mjs:16-32`).
- Rewrite: the `ScriptProcessorNode` chain must become an AudioWorklet pcm-downsample node (BRIEF architecture; garrison never built one).
- Dependencies/licenses: `@ricky0123/vad-web@^0.0.30` — ISC (npm-verified); `onnxruntime-web@^1.26.0` — MIT; Silero VAD model files ship inside vad-web's dist. Worklet + model + ort WASM assets must be self-hosted next to the bundle (CSP: no CDN; matches ekoa's strict CSP posture — serve from the web app's static dir).

**C5 — TTS pipeline (mixed).**
- Port + extend: sanitizer from `toSpeakable()` (`feat/local-voice-jarvis:fittings/seed/jarvis-os/ui/main.tsx:105-138`); sentence-queue playback pattern from `enqueueSpeech`/drain (main.tsx:296-310).
- New: `normalizeNumbersPt`/en (no `speakable-numbers-pt` exists anywhere in garrison history — pickaxe empty); per-language provider config (concept precedent only: local-voice `piper_voices` map, `feat/local-voice-jarvis:fittings/seed/local-voice/apm.yml:40-41`); `AudioBufferSourceNode` playback (garrison uses MediaElement `Audio`, which the BRIEF's field-tested iOS checklist, BRIEF.md:136, says plays silent on mobile Safari — do not port that path); barge-in `clear` handshake with C1.
- License note: Deepgram/Google/ElevenLabs are API services (no code license implication); nothing GPL enters the tree from this port map.
