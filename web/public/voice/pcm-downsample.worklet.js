/* global AudioWorkletProcessor, registerProcessor, sampleRate */
/**
 * pcm-downsample AudioWorklet processor (mega-run C4, BRIEF §5 architecture).
 *
 * Runs on the audio rendering thread: takes the mic input at the AudioContext's NATIVE
 * rate (never hardcoded - iOS locks the context to 48 kHz and ignores a requested 16 k;
 * headless Chromium has been seen at 44.1 k and 192 k) and linear-interpolation resamples
 * it to 16 kHz 16-bit linear PCM, the wire format of WS /api/voice/stream. The fractional
 * read position carries across process() blocks and the previous block's last sample seeds
 * cross-boundary interpolation, so block edges introduce no discontinuity.
 *
 * This REWRITES garrison's deprecated ScriptProcessorNode chain as a worklet (analysis
 * 07-voice-reuse §4-C4): only the resample math and the native-rate rule are ported.
 *
 * Messages OUT (port.postMessage):
 *   { type: 'frames', frames: Int16Array, level: number }  - one packed 16 kHz chunk
 *     (chunkSamples samples, transferred) + the RMS level of the raw input that produced
 *     it (0..1, garrison's *4 display scaling applied), feeding the UI level meter.
 * Messages IN: none. There is deliberately no teardown flush: the ≤64 ms remainder could
 *   only arrive asynchronously, after capture.stop() has already stopped forwarding and
 *   the STT stream is closed - a tail frame would have no consumer.
 *
 * The math here is exercised DIRECTLY by web/__tests__/voice/pcm-worklet.test.ts, which
 * imports this file with stubbed worklet globals - keep it dependency-free ES2020.
 */

const TARGET_RATE = 16000;
const DEFAULT_CHUNK_SAMPLES = 1024; // ~64 ms at 16 kHz per posted frame

class PcmDownsampleProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetRate || TARGET_RATE;
    this.chunkSamples = opts.chunkSamples || DEFAULT_CHUNK_SAMPLES;
    // Native context rate -> target ratio. sampleRate is the worklet global; it is read,
    // never assumed (the mobile/iOS checklist rule).
    this.ratio = sampleRate / this.targetRate;
    this.pos = 0; // fractional read position relative to the current block start
    this.prev = 0; // last sample of the previous block (cross-boundary interpolation)
    this.out = new Int16Array(this.chunkSamples);
    this.outLen = 0;
    this.sumSquares = 0; // raw-input RMS accumulation for the level meter
    this.sumCount = 0;
  }

  postChunk(length) {
    const frames = this.out.subarray(0, length).slice();
    const rms = this.sumCount > 0 ? Math.sqrt(this.sumSquares / this.sumCount) : 0;
    const level = Math.min(1, rms * 4);
    this.sumSquares = 0;
    this.sumCount = 0;
    this.port.postMessage({ type: 'frames', frames, level }, [frames.buffer]);
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;
    const n = input.length;

    for (let i = 0; i < n; i++) {
      const s = input[i];
      this.sumSquares += s * s;
    }
    this.sumCount += n;

    // Emit output samples while the read position falls inside this block. Index -1 is
    // the previous block's last sample, so interpolation is continuous across blocks.
    let pos = this.pos;
    while (pos <= n - 1) {
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const s0 = i0 < 0 ? this.prev : input[i0];
      const s1 = input[Math.min(i0 + 1, n - 1)];
      const s = s0 * (1 - frac) + s1 * frac;
      const v = Math.max(-1, Math.min(1, s));
      this.out[this.outLen++] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
      if (this.outLen === this.chunkSamples) {
        this.outLen = 0;
        this.postChunk(this.chunkSamples);
      }
      pos += this.ratio;
    }
    this.pos = pos - n; // carry the fractional remainder into the next block
    this.prev = input[n - 1];
    return true;
  }
}

registerProcessor('pcm-downsample', PcmDownsampleProcessor);
