/**
 * Speech channel (mega-run C4): everything between the reducer's say/clearTts effects and
 * audible audio. Composes the SentenceAssembler (pure chunk -> sentence buffering) with a
 * one-say-at-a-time coordinator over the tts socket + the C5 TtsPlayback:
 *
 *  - The relay treats a new `say` as SUPERSEDING the one in flight (shared/src/voice.ts),
 *    so sentences are strictly serialized: the next say goes out only after the previous
 *    one's audio_end arrived AND its local playback fully drained (audio_end means all
 *    frames were SENT; playback lags by decode + play time - clearing early would clip).
 *  - clear() is the barge-in path: drop buffered text, abort the in-flight synthesis on
 *    the wire, and stop + flush local playback NOW.
 *  - idle + onIdle feed the driver's drain-then-re-arm rule (agentDone only when the reply
 *    stream AND the speech queue have fully drained - the jarvis endTurnIfDone seed).
 *
 * The playback and socket are injected (structural interfaces), so a test drives the whole
 * coordination with fakes - no Web Audio, no network.
 */
import type { VoiceLang, VoiceTtsServerMessage } from '@ekoa/shared';
import { SentenceAssembler } from './sentence-assembler';

/** Structural surface of the C5 TtsPlayback actually used here. */
export interface PlaybackLike {
  unlock(): void;
  beginTurn(): void;
  pushAudio(frame: Uint8Array): void;
  endTurn(): void;
  bargeIn(): void;
}

/** Structural surface of tts-socket.ts actually used here. */
export interface TtsSayChannel {
  say(text: string, lang: VoiceLang, ids?: { turnId?: string; sheetId?: string }): Promise<void>;
  clear(): void;
}

export interface SpeechChannelHooks {
  /** A sentence became audible (the driver dispatches ttsFirstAudio; reducer dedupes). */
  onAudible(): void;
  /** The channel fully drained (no queued sentences, nothing in flight, nothing audible). */
  onIdle(): void;
  onError(code: 'VOICE_TTS_FAILED'): void;
}

export class SpeechChannel {
  private readonly assembler = new SentenceAssembler();
  private queue: string[] = [];
  private sayInFlight = false;
  /** audio_end received for the in-flight say (may still be playing locally). */
  private audioEnded = false;
  /** Local playback audibly started for the in-flight say. */
  private playbackStarted = false;
  private generation = 0;

  constructor(
    private readonly socket: TtsSayChannel,
    private readonly playback: PlaybackLike,
    private readonly lang: () => VoiceLang,
    private readonly hooks: SpeechChannelHooks,
  ) {}

  /** MUST be forwarded synchronously from a user tap (the iOS unlock rule). */
  unlock(): void {
    this.playback.unlock();
  }

  get idle(): boolean {
    return !this.sayInFlight && this.queue.length === 0;
  }

  /** Reducer `say` effect: buffer chunk text; completed sentences join the say queue. */
  enqueueText(text: string): void {
    for (const sentence of this.assembler.push(text)) this.queue.push(sentence);
    this.pump();
  }

  /** Reply stream settled: the unterminated tail becomes the last say. */
  flushText(): void {
    const tail = this.assembler.flush();
    if (tail) this.queue.push(tail);
    this.pump();
  }

  /** Reducer `clearTts` effect (barge-in) and the teardown path. */
  clear(): void {
    this.assembler.reset();
    this.queue = [];
    this.generation += 1;
    const hadFlight = this.sayInFlight;
    this.sayInFlight = false;
    this.audioEnded = false;
    this.playbackStarted = false;
    if (hadFlight) this.socket.clear();
    this.playback.bargeIn();
  }

  /* ------------------------- wiring from the socket + playback ------------------------- */

  /** Route every JSON message from the tts socket here. */
  handleMessage(msg: VoiceTtsServerMessage): void {
    switch (msg.type) {
      case 'audio_end':
        if (!this.sayInFlight) return;
        this.audioEnded = true;
        this.playback.endTurn();
        // Nothing ever became audible (empty speakable text, or decode failures consumed
        // everything): playback will never signal an end - finish the say here.
        if (!this.playbackStarted) this.finishSay();
        return;
      case 'cleared':
        // Confirmation of our clear (or a supersede echo); local state already reset.
        return;
      case 'error':
        this.hooks.onError('VOICE_TTS_FAILED');
        if (this.sayInFlight) this.finishSay();
        return;
      default:
        return; // ready / speaking need no action (beginTurn rides the say send)
    }
  }

  /** Route every binary frame from the tts socket here. */
  handleAudio(frame: Uint8Array): void {
    if (this.sayInFlight) this.playback.pushAudio(frame);
  }

  /** Playback hooks (wire these into the TtsPlayback deps). */
  handlePlaybackStart(): void {
    this.playbackStarted = true;
    this.hooks.onAudible();
  }

  handlePlaybackEnd(): void {
    if (this.sayInFlight && this.audioEnded) this.finishSay();
  }

  /** The socket dropped mid-turn: nothing more will arrive for the in-flight say. */
  handleSocketDrop(): void {
    if (this.sayInFlight) {
      this.playback.bargeIn();
      this.finishSay();
    }
  }

  /* ------------------------------------ internals ------------------------------------ */

  private finishSay(): void {
    this.sayInFlight = false;
    this.audioEnded = false;
    this.playbackStarted = false;
    this.pump();
    if (this.idle) this.hooks.onIdle();
  }

  private pump(): void {
    if (this.sayInFlight) return;
    const sentence = this.queue.shift();
    if (sentence === undefined) return;
    this.sayInFlight = true;
    this.audioEnded = false;
    this.playbackStarted = false;
    this.playback.beginTurn();
    const gen = this.generation;
    this.socket.say(sentence, this.lang()).catch(() => {
      if (gen !== this.generation) return; // cleared while dialing
      this.hooks.onError('VOICE_TTS_FAILED');
      this.finishSay();
    });
  }
}
