import { z } from 'zod';

/**
 * Voice WS contract (mega-run C1, BRIEF §5 Part C). The message shapes both directions on the
 * two voice WebSocket channels. These are WS carve-outs like streaming/ (FIXED-2 sibling), NOT
 * REST endpoints: no descriptor map entry, no SSE union. Binary frames (linear16 PCM up on
 * /stream, synthesized audio down on /tts-stream) ride the socket as binary messages and are
 * deliberately NOT representable here - only the JSON control/transcript/event messages are.
 * The web client validates every JSON message it sends/receives against these unions; the api
 * relay does the same on its side.
 */

/** Canonical WS paths (single source of truth for client dial + server upgrade routing). */
export const VOICE_STT_WS_PATH = '/api/voice/stream';
export const VOICE_TTS_WS_PATH = '/api/voice/tts-stream';

/** The three product languages (BRIEF §5; locale-only pt-PT/pt-BR resolution, decided). */
export const VoiceLang = z.enum(['pt-PT', 'pt-BR', 'en']);
export type VoiceLang = z.infer<typeof VoiceLang>;

/* ------------------------------- /api/voice/stream (STT) ------------------------------- */

/** Client -> server JSON on /api/voice/stream. Audio itself is binary 16 kHz linear16 mono
 *  PCM frames (not JSON). `close_stream` asks the relay to flush + finalize the provider
 *  stream; the relay closes the socket when the provider drains. `turn_committed` (C2)
 *  annotates the LAST finished turn (the most recent `utterance_end`) with the REFERENCE to
 *  the chat message its final transcript became, plus the client mode - refs only, never
 *  transcript text (the A5 vocabulary memo rule 2); the relay writes the turn's `voice.turn`
 *  audit row on receipt, or without the ref if none arrives before the next turn / close.
 *  Attribution (org + user) always comes from the verified upgrade token, never from these
 *  messages. Session parameters ride the upgrade query string
 *  (`?token=&sample_rate=&utterance_end_ms=&lang=`), mirroring the SSE token-query idiom
 *  (CONV-1) - a browser WS cannot set headers. */
export const VoiceSttClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('close_stream') }),
  z.object({
    type: z.literal('turn_committed'),
    /** Id of the chat message the finished turn's final transcript became. A ref, never text:
     *  capped at an id length so a client cannot smuggle prose into the audit row (A5 rule 2).
     *  CLIENT-ASSERTED: the server records it on the caller's own activity log as reported and
     *  does not verify it resolves to a real message - never treat it as a validated FK. */
    transcriptMessageId: z.string().min(1).max(128),
    /** The client voice-machine mode the turn ran under (BRIEF §5). */
    mode: z.enum(['manual', 'talking']).optional(),
  }),
]);
export type VoiceSttClientMessage = z.infer<typeof VoiceSttClientMessage>;

/** Server -> client JSON on /api/voice/stream. `ready` echoes the negotiated session
 *  parameters; `transcript` streams interim (isFinal=false) and final results; `utterance_end`
 *  carries the accumulated final transcript for the turn (fires after `utteranceEndMs` of
 *  silence - the endpointing input for auto-send in talking mode). */
export const VoiceSttServerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    sessionId: z.string(),
    sampleRate: z.number().int(),
    utteranceEndMs: z.number().int(),
    sttProvider: z.string(),
  }),
  z.object({ type: z.literal('speech_started') }),
  z.object({
    type: z.literal('transcript'),
    text: z.string(),
    isFinal: z.boolean(),
    speechFinal: z.boolean(),
  }),
  z.object({ type: z.literal('utterance_end'), transcript: z.string() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type VoiceSttServerMessage = z.infer<typeof VoiceSttServerMessage>;

/* ----------------------------- /api/voice/tts-stream (TTS) ----------------------------- */

/** Client -> server JSON on /api/voice/tts-stream. `say` starts synthesis of one reply chunk
 *  in the given language (a new `say` supersedes a still-playing one); `clear` aborts the
 *  current synthesis immediately - the barge-in path (BRIEF §5, shipped in v1 talking mode). */
export const VoiceTtsClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('say'),
    text: z.string().min(1),
    lang: VoiceLang,
    /** Client correlation id; echoed on `speaking`/`audio_end`/`cleared`. Generated when absent.
     *  Capped at an id length - it reaches latency logs, so it must not carry prose (A5 rule 2). */
    turnId: z.string().min(1).max(128).optional(),
    /** Optional ref to the sheet whose summary is being spoken - rides the `voice.tts` audit
     *  row's metadata (refs only, never content). Capped at an id length (A5 rule 2). */
    sheetId: z.string().min(1).max(128).optional(),
  }),
  z.object({ type: z.literal('clear') }),
]);
export type VoiceTtsClientMessage = z.infer<typeof VoiceTtsClientMessage>;

/** Server -> client JSON on /api/voice/tts-stream. Audio itself streams down as binary frames
 *  between `speaking` and `audio_end`. `cleared` confirms a barge-in `clear` (or a superseding
 *  `say`) stopped the previous turn's audio - nothing more for that turnId follows it. */
export const VoiceTtsServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), sessionId: z.string() }),
  z.object({
    type: z.literal('speaking'),
    turnId: z.string(),
    lang: VoiceLang,
    ttsProvider: z.string(),
  }),
  z.object({ type: z.literal('audio_end'), turnId: z.string() }),
  z.object({ type: z.literal('cleared'), turnId: z.string().optional() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type VoiceTtsServerMessage = z.infer<typeof VoiceTtsServerMessage>;
