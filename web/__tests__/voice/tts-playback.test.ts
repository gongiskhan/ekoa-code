// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { SentenceQueue } from '@/lib/voice/playback-queue';
import { TtsPlayback, type AudioBufferLike, type AudioContextLike, type AudioSourceLike } from '@/lib/voice/tts-playback';

/**
 * C5 (mega-run 20260717-190134): the TTS playback path per the mobile/iOS checklist. The
 * ordering/flush/unlock invariants are pure (SentenceQueue; hand-rolled fake AudioContext -
 * no mock framework): decode completes out of order but playback is strictly in order,
 * barge-in stops + flushes, unlock is SYNCHRONOUS inside the tap frame, resume() re-fires
 * defensively, and the sample rate always comes from the context/file - never a constant.
 */

/* --------------------------------- SentenceQueue --------------------------------- */

describe('SentenceQueue ordering', () => {
  it('plays in enqueue order even when decode completes out of order', () => {
    const q = new SentenceQueue();
    const s0 = q.enqueue();
    const s1 = q.enqueue();
    const s2 = q.enqueue();

    q.markReady(s2); // last sentence decodes first
    expect(q.nextToPlay()).toBeNull(); // head still decoding: order over latency

    q.markReady(s0);
    expect(q.nextToPlay()).toBe(s0);
    q.markPlaying(s0);
    expect(q.nextToPlay()).toBeNull(); // one at a time

    q.markDone(s0);
    expect(q.nextToPlay()).toBeNull(); // s1 not ready yet
    q.markReady(s1);
    expect(q.nextToPlay()).toBe(s1);
    q.markPlaying(s1);
    q.markDone(s1);
    expect(q.nextToPlay()).toBe(s2);
    q.markPlaying(s2);
    q.markDone(s2);
    expect(q.idle).toBe(true);
  });

  it('skips a failed decode without stalling the rest', () => {
    const q = new SentenceQueue();
    const s0 = q.enqueue();
    const s1 = q.enqueue();
    q.markFailed(s0);
    q.markReady(s1);
    expect(q.nextToPlay()).toBe(s1);
  });

  it('refuses an out-of-order markPlaying (the invariant is the module)', () => {
    const q = new SentenceQueue();
    q.enqueue();
    const s1 = q.enqueue();
    q.markReady(s1);
    expect(() => q.markPlaying(s1)).toThrow(/out-of-order/);
  });

  it('flush() discards playing + pending and reports them; late marks are ignored', () => {
    const q = new SentenceQueue();
    const s0 = q.enqueue();
    const s1 = q.enqueue();
    const s2 = q.enqueue();
    q.markReady(s0);
    q.markPlaying(s0);
    q.markReady(s1);
    expect(q.flush().sort()).toEqual([s0, s1, s2].sort());
    expect(q.idle).toBe(true);
    q.markReady(s2); // late decode of a flushed sentence
    expect(q.nextToPlay()).toBeNull();
  });
});

/* ------------------------------- fake audio context ------------------------------- */

class FakeSource implements AudioSourceLike {
  buffer: AudioBufferLike | null = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connected: unknown = null;
  connect(destination: unknown): unknown {
    this.connected = destination;
    return destination;
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  /** Test hook: the sentence finished sounding. */
  finish(): void {
    this.onended?.();
  }
}

class FakeCtx implements AudioContextLike {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  sampleRate = 48_000; // an iOS-locked device rate; nothing below may assume 16 kHz
  destination = { node: 'destination' };
  resumeCalls = 0;
  sources: FakeSource[] = [];
  createdBuffers: Array<{ channels: number; length: number; sampleRate: number }> = [];
  decodes: Array<{ resolve: (b: AudioBufferLike) => void; reject: (e: Error) => void }> = [];

  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike {
    this.createdBuffers.push({ channels, length, sampleRate });
    return { duration: 0 };
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    void data; // the fake ignores bytes; ordering is what is under test
    return new Promise((resolve, reject) => this.decodes.push({ resolve, reject }));
  }
}

/** Well-formed 44-byte-header WAV bytes (the wire's container shape). */
function makeWav(dataLength: number, sampleRate = 16_000): Uint8Array {
  const bytes = new Uint8Array(44 + dataLength);
  const dv = new DataView(bytes.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + dataLength, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ascii(36, 'data');
  dv.setUint32(40, dataLength, true);
  return bytes;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const ctx = new FakeCtx();
  const events: string[] = [];
  const playback = new TtsPlayback({
    createContext: () => ctx,
    onError: (code) => events.push(`error:${code}`),
    onPlaybackStart: () => events.push('start'),
    onPlaybackEnd: () => events.push('end'),
  });
  return { ctx, events, playback };
}

/* ----------------------------------- unlock ----------------------------------- */

describe('TtsPlayback unlock (iOS gesture rule)', () => {
  it('is fully SYNCHRONOUS: context created, silent source started, resume kicked - no await', () => {
    const { ctx, playback } = setup();
    expect(playback.unlocked).toBe(false);
    playback.unlock(); // inside the tap handler frame
    // Everything observable happened before any microtask ran:
    expect(playback.unlocked).toBe(true);
    expect(ctx.sources.length).toBe(1);
    expect(ctx.sources[0].started).toBe(true);
    expect(ctx.sources[0].connected).toBe(ctx.destination);
    expect(ctx.resumeCalls).toBe(1);
    // The silent tick uses the CONTEXT's own rate - never a hardcoded one.
    expect(ctx.createdBuffers[0]).toEqual({ channels: 1, length: 1, sampleRate: 48_000 });
  });

  it('is idempotent: a second tap re-kicks resume on the SAME context', () => {
    const { ctx, playback } = setup();
    playback.unlock();
    playback.unlock();
    expect(ctx.resumeCalls).toBe(2);
    expect(ctx.sources.length).toBe(2); // one silent tick per tap - harmless, per the checklist
  });
});

/* ---------------------------------- playback ---------------------------------- */

describe('TtsPlayback sentence playback', () => {
  it('plays sentences in order despite out-of-order decode, then signals end after audio_end', async () => {
    const { ctx, events, playback } = setup();
    playback.unlock();
    playback.beginTurn();
    playback.pushAudio(makeWav(20));
    playback.pushAudio(makeWav(30));
    expect(ctx.decodes.length).toBe(2);

    // Sentence 2 decodes FIRST - nothing may sound yet.
    ctx.decodes[1].resolve({ duration: 0.3 });
    await tick();
    expect(ctx.sources.length).toBe(1); // only the unlock tick so far
    expect(events).not.toContain('start');

    ctx.decodes[0].resolve({ duration: 0.2 });
    await tick();
    expect(events).toContain('start');
    const first = ctx.sources[1];
    expect(first.started).toBe(true);
    expect(first.buffer).toEqual({ duration: 0.2 }); // sentence ONE's buffer, not two's

    first.finish();
    const second = ctx.sources[2];
    expect(second.started).toBe(true);
    expect(second.buffer).toEqual({ duration: 0.3 });

    playback.endTurn(); // audio_end while the last sentence still sounds
    expect(events).not.toContain('end');
    second.finish();
    expect(events).toContain('end');
    expect(playback.playing).toBe(false);
  });

  it('re-kicks resume() defensively before a sentence when the context re-suspended', async () => {
    const { ctx, playback } = setup();
    playback.unlock();
    playback.beginTurn();
    playback.pushAudio(makeWav(10));
    ctx.state = 'suspended'; // iOS re-suspended (route change / backgrounding)
    ctx.decodes[0].resolve({ duration: 0.1 });
    await tick();
    expect(ctx.resumeCalls).toBe(2); // unlock + the defensive re-kick
    expect(ctx.sources[1].started).toBe(true);
  });

  it('skips a failed decode and keeps playing the rest', async () => {
    const { ctx, events, playback } = setup();
    playback.unlock();
    playback.beginTurn();
    playback.pushAudio(makeWav(10));
    playback.pushAudio(makeWav(12));
    ctx.decodes[1].resolve({ duration: 0.2 });
    ctx.decodes[0].reject(new Error('decode failed'));
    await tick();
    expect(events).toContain('error:AUDIO_DECODE_FAILED');
    const src = ctx.sources[1];
    expect(src.buffer).toEqual({ duration: 0.2 }); // sentence two sounds; one skipped
    playback.endTurn();
    src.finish();
    expect(events).toContain('end');
  });

  it('surfaces malformed audio (bad container) without playing it', () => {
    const { events, playback } = setup();
    playback.unlock();
    playback.beginTurn();
    playback.pushAudio(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]));
    expect(events).toContain('error:AUDIO_MALFORMED');
  });

  it('reassembles a sentence split across frames before decoding', () => {
    const { ctx, playback } = setup();
    playback.unlock();
    playback.beginTurn();
    const wav = makeWav(40);
    playback.pushAudio(wav.subarray(0, 25));
    expect(ctx.decodes.length).toBe(0); // incomplete: nothing decoded yet
    playback.pushAudio(wav.subarray(25));
    expect(ctx.decodes.length).toBe(1);
  });
});

/* ----------------------------------- barge-in ----------------------------------- */

describe('TtsPlayback barge-in (clear)', () => {
  it('stops the audible source NOW, flushes the queue, and drops late decodes + stray audio', async () => {
    const { ctx, events, playback } = setup();
    playback.unlock();
    playback.beginTurn();
    playback.pushAudio(makeWav(20));
    playback.pushAudio(makeWav(30));
    ctx.decodes[0].resolve({ duration: 0.2 });
    await tick();
    const audible = ctx.sources[1];
    expect(audible.started).toBe(true);

    playback.bargeIn();
    expect(audible.stopped).toBe(true);
    expect(events).toContain('end');

    // The still-pending decode resolving later must NOT start anything.
    ctx.decodes[1].resolve({ duration: 0.3 });
    await tick();
    expect(ctx.sources.length).toBe(2); // unlock tick + the stopped sentence, nothing new

    // Stray audio after the clear is dropped by design.
    playback.pushAudio(makeWav(10));
    expect(ctx.decodes.length).toBe(2);
    expect(playback.playing).toBe(false);
  });

  it('a stopped source firing onended later never restarts the queue', async () => {
    const { ctx, playback } = setup();
    playback.unlock();
    playback.beginTurn();
    playback.pushAudio(makeWav(20));
    playback.pushAudio(makeWav(30));
    ctx.decodes[0].resolve({ duration: 0.2 });
    ctx.decodes[1].resolve({ duration: 0.3 });
    await tick();
    const audible = ctx.sources[1];
    playback.bargeIn();
    audible.finish(); // browser fires ended for the stopped node
    await tick();
    expect(ctx.sources.length).toBe(2); // sentence two never started
  });

  it('bargeIn with nothing playing is a safe no-op', () => {
    const { events, playback } = setup();
    playback.unlock();
    playback.bargeIn();
    expect(events).toEqual([]);
  });
});
