/**
 * TTS playback client (BRIEF §5 mobile/iOS checklist, run 20260717-190134, slice C5). The
 * thin Web Audio layer over the pure parts (wav.ts segmentation, playback-queue.ts ordering):
 * binary frames from WS /api/voice/tts-stream go in, sentences play in order through decoded
 * AudioBufferSourceNodes, and barge-in stops + flushes everything.
 *
 * Field-tested iOS rules encoded here (every one mandatory, BRIEF §5):
 *  - unlock() is SYNCHRONOUS and must be called INSIDE a user tap handler BEFORE any await:
 *    it creates the AudioContext, starts a silent buffer source and kicks resume() without
 *    awaiting - the gesture stack frame is what iOS honours;
 *  - ctx.resume() is re-kicked DEFENSIVELY before every sentence start (iOS re-suspends on
 *    route changes / backgrounding);
 *  - playback is a decoded AudioBufferSourceNode PER SENTENCE - never MediaElementSource,
 *    which plays silent on mobile Safari;
 *  - the sample rate is never hardcoded: each WAV header is validated (parseWavHeader) and
 *    decodeAudioData resamples to whatever rate the device context runs at (iOS locks 48 kHz).
 *
 * The AudioContext is INJECTED (deps.createContext), so every state transition here is
 * exercisable in unit tests with a hand-rolled fake - no browser, no mocks framework.
 */
import { parseWavHeader, WavStreamSegmenter, type SegmenterError } from './wav';
import { SentenceQueue } from './playback-queue';

/* Minimal structural surface of Web Audio actually used - keeps the fake honest and small. */
export interface AudioBufferLike {
  duration: number;
}
export interface AudioSourceLike {
  buffer: AudioBufferLike | null;
  connect(destination: unknown): unknown;
  start(when?: number): void;
  stop(): void;
  onended: (() => void) | null;
}
export interface AudioContextLike {
  state: 'suspended' | 'running' | 'closed';
  sampleRate: number;
  destination: unknown;
  resume(): Promise<void>;
  /** Present on the real AudioContext; owners close their context on unmount teardown. */
  close?(): Promise<void>;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioSourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
}

export interface TtsPlaybackDeps {
  createContext: () => AudioContextLike;
  /** Malformed audio surfaces here (PT-PT copy is the caller's concern; this is a code). */
  onError?: (code: 'AUDIO_MALFORMED' | 'AUDIO_DECODE_FAILED') => void;
  /** Fires when a turn's audio actually starts / fully drains (UI speaking indicator). */
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
}

export type UnlockState = 'locked' | 'unlocked';

export class TtsPlayback {
  private ctx: AudioContextLike | null = null;
  private unlockState: UnlockState = 'locked';
  private readonly queue = new SentenceQueue();
  private readonly buffers = new Map<number, AudioBufferLike>();
  private readonly segmenter: WavStreamSegmenter;
  private currentSource: AudioSourceLike | null = null;
  private turnOpen = false;
  private started = false;
  /** Bumped on every beginTurn/bargeIn so late decode callbacks from a flushed turn are inert. */
  private generation = 0;

  constructor(private readonly deps: TtsPlaybackDeps) {
    this.segmenter = new WavStreamSegmenter((err: SegmenterError) => {
      void err;
      this.deps.onError?.('AUDIO_MALFORMED');
    });
  }

  get unlocked(): boolean {
    return this.unlockState === 'unlocked';
  }

  /** True while a sentence is audibly playing. */
  get playing(): boolean {
    return this.queue.playing !== null;
  }

  /**
   * MUST be called synchronously inside a user tap handler, before any await (iOS discards
   * the gesture privilege at the first microtask). Creates the context, starts a one-frame
   * silent source and fires resume() WITHOUT awaiting. Idempotent - call it on every tap.
   */
  unlock(): void {
    if (!this.ctx) this.ctx = this.deps.createContext();
    // Silent tick at the CONTEXT's own rate (never a hardcoded one).
    const silent = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const src = this.ctx.createBufferSource();
    src.buffer = silent;
    src.connect(this.ctx.destination);
    src.start();
    void this.ctx.resume().catch(() => { /* resume re-fires before every sentence */ });
    this.unlockState = 'unlocked';
  }

  /** A `speaking` control message opened a turn: arm the stream for its sentences. */
  beginTurn(): void {
    this.stopCurrent();
    this.queue.flush();
    this.buffers.clear();
    this.segmenter.reset();
    this.generation += 1;
    this.turnOpen = true;
    this.started = false;
  }

  /**
   * A binary WS frame arrived. Complete sentence WAVs are validated, decoded and queued;
   * playback starts as soon as the FIRST sentence is ready (never waiting for the turn).
   */
  pushAudio(frame: Uint8Array): void {
    if (!this.turnOpen) return; // stray audio after clear/end: dropped by design
    for (const wav of this.segmenter.push(frame)) {
      if (!parseWavHeader(wav)) {
        this.deps.onError?.('AUDIO_MALFORMED');
        continue;
      }
      const seq = this.queue.enqueue();
      const ctx = this.ctx;
      if (!ctx) {
        // Not unlocked: nothing can sound. Mark failed so the queue never stalls on it.
        this.queue.markFailed(seq);
        continue;
      }
      // Copy into a fresh ArrayBuffer (decodeAudioData detaches its input on some engines).
      const data = wav.slice().buffer as ArrayBuffer;
      const gen = this.generation;
      ctx.decodeAudioData(data).then(
        (buffer) => {
          if (gen !== this.generation) return; // turn flushed while decoding
          this.buffers.set(seq, buffer);
          this.queue.markReady(seq);
          this.playNext();
        },
        () => {
          if (gen !== this.generation) return;
          this.queue.markFailed(seq);
          this.deps.onError?.('AUDIO_DECODE_FAILED');
          this.playNext(); // a failed head must not stall the rest
        },
      );
    }
  }

  /** `audio_end` arrived: no more sentences for this turn; drain then signal end. */
  endTurn(): void {
    this.turnOpen = false;
    this.maybeFinish();
  }

  /**
   * Barge-in (`clear` sent / `cleared` received): stop the audible sentence NOW, flush the
   * queue and pending bytes. Also the teardown path.
   */
  bargeIn(): void {
    this.stopCurrent();
    const hadAnything = this.queue.flush().length > 0 || this.segmenter.pendingBytes > 0;
    this.buffers.clear();
    this.segmenter.reset();
    this.generation += 1;
    this.turnOpen = false;
    if (hadAnything && this.started) this.deps.onPlaybackEnd?.();
    this.started = false;
  }

  /* ------------------------------- internals ------------------------------- */

  private playNext(): void {
    const seq = this.queue.nextToPlay();
    if (seq === null) {
      this.maybeFinish();
      return;
    }
    const ctx = this.ctx;
    const buffer = this.buffers.get(seq);
    if (!ctx || !buffer) {
      this.queue.markFailed(seq);
      this.playNext();
      return;
    }
    // Defensive resume on EVERY start (iOS re-suspends silently on route changes).
    if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* next start retries */ });
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    this.queue.markPlaying(seq);
    this.currentSource = src;
    if (!this.started) {
      this.started = true;
      this.deps.onPlaybackStart?.();
    }
    src.onended = () => {
      if (this.currentSource === src) this.currentSource = null;
      this.buffers.delete(seq);
      this.queue.markDone(seq);
      this.playNext();
    };
    src.start();
  }

  private stopCurrent(): void {
    const src = this.currentSource;
    this.currentSource = null;
    if (src) {
      src.onended = null; // a stopped source must not re-trigger playNext
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
  }

  private maybeFinish(): void {
    if (!this.turnOpen && this.queue.idle && this.started) {
      this.started = false;
      this.deps.onPlaybackEnd?.();
    }
  }
}
