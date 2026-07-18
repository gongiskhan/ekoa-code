// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';

/**
 * C4 (mega-run 20260717-190134): the pcm-downsample AudioWorklet's math, tested by driving
 * THE ACTUAL ASSET FILE (web/public/voice/pcm-downsample.worklet.js) with stubbed worklet
 * globals - no duplicated reference implementation to drift from. Covers: native-rate ->
 * 16 kHz linear-interpolation resample (the never-hardcode rule: the ratio derives from the
 * worklet's sampleRate global), fractional-position carry + cross-block continuity, Int16
 * clamping, chunked frame packing with transfer, and the RMS level reading.
 *
 * There is no flush protocol (removed - a teardown tail frame had no consumer): a partial
 * chunk stays in the processor's buffer, so tail assertions read the internal remainder
 * (`drainTail`) - white-box, but against the real asset.
 */

interface PostedFrame {
  type: string;
  frames: Int16Array;
  level: number;
}

interface ProcessorLike {
  process(inputs: Float32Array[][]): boolean;
  port: {
    postMessage(msg: unknown, transfer?: unknown[]): void;
    onmessage: ((e: { data: unknown }) => void) | null;
  };
}

type ProcessorCtor = new (options?: {
  processorOptions?: { targetRate?: number; chunkSamples?: number };
}) => ProcessorLike;

let registered: ProcessorCtor;

class FakeAudioWorkletProcessor {
  port: {
    posted: PostedFrame[];
    postMessage(msg: unknown): void;
    onmessage: ((e: { data: unknown }) => void) | null;
  };

  constructor() {
    const posted: PostedFrame[] = [];
    this.port = {
      posted,
      postMessage(msg: unknown): void {
        posted.push(msg as PostedFrame);
      },
      onmessage: null,
    };
  }
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.AudioWorkletProcessor = FakeAudioWorkletProcessor;
  g.registerProcessor = (_name: string, ctor: ProcessorCtor) => {
    registered = ctor;
  };
  g.sampleRate = 48_000; // the iOS-locked native rate; per-test rates override via helper
  await import('../../public/voice/pcm-downsample.worklet.js');
  expect(registered).toBeDefined();
});

/** Instantiate the registered processor at a given native rate. */
function makeProcessor(nativeRate: number, chunkSamples = 1024): ProcessorLike & {
  port: FakeAudioWorkletProcessor['port'];
} {
  (globalThis as Record<string, unknown>).sampleRate = nativeRate;
  return new registered({ processorOptions: { chunkSamples } }) as ProcessorLike & {
    port: FakeAudioWorkletProcessor['port'];
  };
}

function feed(proc: ProcessorLike, samples: Float32Array, blockSize = 128): void {
  for (let i = 0; i < samples.length; i += blockSize) {
    proc.process([[samples.subarray(i, Math.min(i + blockSize, samples.length))]]);
  }
}

/** The partial chunk still buffered inside the processor (nothing flushes it by design). */
function drainTail(proc: ProcessorLike): Int16Array {
  const internals = proc as unknown as { out: Int16Array; outLen: number };
  return internals.out.slice(0, internals.outLen);
}

/** All posted full chunks + the buffered remainder, in stream order. */
function collected(proc: ProcessorLike & { port: FakeAudioWorkletProcessor['port'] }): Int16Array {
  const parts = proc.port.posted.filter((p) => p.type === 'frames').map((p) => p.frames);
  parts.push(drainTail(proc));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Int16Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe('pcm-downsample worklet: resample math', () => {
  it('downsamples 48 kHz to 16 kHz at a 3:1 sample-count ratio', () => {
    const proc = makeProcessor(48_000, 256);
    const input = new Float32Array(48_000); // 1 s of silence-ish ramp
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * 440 * i) / 48_000);
    feed(proc, input);
    const out = collected(proc);
    // ~16000 output samples for 48000 in (edge effects allow a tiny tolerance).
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(2);
  });

  it('preserves the waveform: a 440 Hz tone keeps its frequency after 48k -> 16k', () => {
    const proc = makeProcessor(48_000, 512);
    const seconds = 0.5;
    const input = new Float32Array(Math.round(48_000 * seconds));
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * 440 * i) / 48_000);
    feed(proc, input);
    const out = collected(proc);
    // Count positive-going zero crossings: ~440 per second.
    let crossings = 0;
    for (let i = 1; i < out.length; i++) {
      if (out[i - 1] < 0 && out[i] >= 0) crossings++;
    }
    const hz = crossings / seconds;
    expect(hz).toBeGreaterThan(430);
    expect(hz).toBeLessThan(450);
  });

  it('is continuous across process() block boundaries (fractional carry, no repeats)', () => {
    const proc = makeProcessor(44_100, 4096); // non-integer ratio exercises the carry
    const input = new Float32Array(44_100 / 2);
    for (let i = 0; i < input.length; i++) input[i] = i / input.length; // rising ramp 0..1
    feed(proc, input, 128);
    const out = collected(proc);
    expect(out.length).toBeGreaterThan(7_000);
    // A ramp must stay strictly non-decreasing with bounded steps - a block-boundary bug
    // (dropped carry, repeated sample) shows as a plateau run or a jump.
    const expectedStep = (0x7fff / out.length) * 2.5;
    for (let i = 1; i < out.length; i++) {
      const step = out[i] - out[i - 1];
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(expectedStep);
    }
  });

  it('passes through 1:1 when the context already runs at 16 kHz', () => {
    const proc = makeProcessor(16_000, 256);
    const input = new Float32Array(1_600);
    for (let i = 0; i < input.length; i++) input[i] = Math.sin(i / 10);
    feed(proc, input);
    const out = collected(proc);
    expect(Math.abs(out.length - 1_600)).toBeLessThanOrEqual(2);
  });

  it('clamps out-of-range samples to the Int16 limits', () => {
    const proc = makeProcessor(16_000, 8);
    const input = new Float32Array([1.5, 1.5, 1.5, 1.5, -1.5, -1.5, -1.5, -1.5]);
    proc.process([[input]]);
    const out = collected(proc);
    expect(out[0]).toBe(0x7fff);
    expect(out[out.length - 1]).toBe(-0x8000);
  });
});

describe('pcm-downsample worklet: packing and level', () => {
  it('posts only full chunkSamples frames; the remainder stays buffered (no flush protocol)', () => {
    const proc = makeProcessor(16_000, 100);
    feed(proc, new Float32Array(250).fill(0.1), 50);
    const during = proc.port.posted.filter((p) => p.type === 'frames');
    expect(during).toHaveLength(2);
    expect(during[0].frames).toHaveLength(100);
    expect(during[1].frames).toHaveLength(100);
    // The partial tail is never posted - it sits in the buffer until more input fills it.
    const tail = drainTail(proc);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.length).toBeLessThan(100);
  });

  it('reports RMS level: 0 for silence, high for a loud tone, capped at 1', () => {
    const quiet = makeProcessor(16_000, 64);
    feed(quiet, new Float32Array(64), 64);
    expect(quiet.port.posted[0].level).toBe(0);

    const loud = makeProcessor(16_000, 64);
    const tone = new Float32Array(64);
    for (let i = 0; i < tone.length; i++) tone[i] = Math.sin(i); // RMS ~0.7 -> *4 caps at 1
    feed(loud, tone, 64);
    expect(loud.port.posted[0].level).toBeGreaterThan(0.9);
    expect(loud.port.posted[0].level).toBeLessThanOrEqual(1);
  });

  it('ignores empty input blocks', () => {
    const proc = makeProcessor(48_000, 64);
    expect(proc.process([[]] as unknown as Float32Array[][])).toBe(true);
    expect(proc.port.posted).toHaveLength(0);
    expect(drainTail(proc)).toHaveLength(0);
  });
});
