/**
 * voice/stub-providers.ts - the deterministic fake providers (mega-run C1). v1 ships ONLY
 * these; live vendors are C6 (vendor-gated). Hand-rolled, zero SDK imports.
 *
 *  - STT stub: replays scripted transcripts when it sees a MARKER FRAME - a binary frame
 *    whose bytes start with `EKOA-STT:<scriptKey>`. Real PCM (anything else) is accepted and
 *    counted but transcribes nothing, so tests drive exact interim -> final -> utterance_end
 *    sequences without audio or keys.
 *  - TTS stub: emits a VALID 16 kHz mono 16-bit WAV header followed by 440 Hz tone frames
 *    (iOS Safari is strict about WAV headers - the stub honours the real container shape so
 *    the client playback path is exercised for real). Chunk pacing is a small real delay so
 *    a mid-stream {clear} (barge-in) observably stops it.
 */
import type { VoiceLang } from '@ekoa/shared';
import type { SttOpenOpts, SttProviderEvent, SttStream, VoiceAttribution } from './providers.js';

/* ------------------------------ async push-queue helper ------------------------------ */

/** Minimal push -> AsyncIterable adapter: the stub pushes events, the relay for-awaits them. */
class PushQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T): void {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w({ value, done: false });
    else this.buffer.push(value);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift() as T, done: false });
        }
        if (this.ended) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

/* ------------------------------------- STT stub ------------------------------------- */

export const STT_STUB_MARKER_PREFIX = 'EKOA-STT:';

/** The scripted turns the STT stub can replay, keyed by marker. Deterministic: one marker
 *  frame yields speech_started -> interim -> final -> utterance_end, in order, always. */
export const STT_STUB_SCRIPTS: Record<string, { interim: string; final: string }> = {
  ola: { interim: 'Olá', final: 'Olá, bom dia.' },
  prazo: { interim: 'Qual é o prazo', final: 'Qual é o prazo do processo?' },
};

export function createStubSttStream(_opts: SttOpenOpts): SttStream {
  const queue = new PushQueue<SttProviderEvent>();
  let closed = false;

  return {
    sendAudio(frame: Buffer): void {
      if (closed) return;
      const head = frame.toString('utf8', 0, STT_STUB_MARKER_PREFIX.length);
      if (head !== STT_STUB_MARKER_PREFIX) return; // plain PCM: accepted, transcribes nothing
      const key = frame.toString('utf8', STT_STUB_MARKER_PREFIX.length).trim();
      const script = STT_STUB_SCRIPTS[key];
      if (!script) return; // unknown marker: treated as plain audio
      queue.push({ kind: 'speech_started' });
      queue.push({ kind: 'transcript', text: script.interim, isFinal: false, speechFinal: false });
      queue.push({ kind: 'transcript', text: script.final, isFinal: true, speechFinal: true });
      queue.push({ kind: 'utterance_end', transcript: script.final });
    },
    close(): void {
      if (closed) return;
      closed = true;
      queue.end();
    },
    events: queue,
  };
}

/* ------------------------------------- TTS stub ------------------------------------- */

const TTS_SAMPLE_RATE = 16_000;
const TONE_CHUNK_MS = 20; // one 20 ms tone frame per chunk
const TONE_CHUNK_SAMPLES = (TTS_SAMPLE_RATE * TONE_CHUNK_MS) / 1000;
const INTER_CHUNK_DELAY_MS = 4; // real pacing so {clear} lands mid-stream in tests

/** A complete, honest 44-byte linear16 mono WAV header for a known data length. */
export function wavHeader(dataLength: number, sampleRate: number = TTS_SAMPLE_RATE): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataLength, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16); // PCM fmt chunk size
  h.writeUInt16LE(1, 20); // audio format: PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); // byte rate (16-bit mono)
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits per sample
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataLength, 40);
  return h;
}

function toneChunk(chunkIndex: number, frequencyHz: number): Buffer {
  const buf = Buffer.alloc(TONE_CHUNK_SAMPLES * 2);
  const phaseOffset = chunkIndex * TONE_CHUNK_SAMPLES;
  for (let i = 0; i < TONE_CHUNK_SAMPLES; i++) {
    const t = (phaseOffset + i) / TTS_SAMPLE_RATE;
    const sample = Math.round(0.25 * 32767 * Math.sin(2 * Math.PI * frequencyHz * t));
    buf.writeInt16LE(sample, i * 2);
  }
  return buf;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function* createStubTtsStream(
  text: string,
  lang: VoiceLang,
  signal: AbortSignal,
  _attribution: VoiceAttribution,
): AsyncIterable<Buffer> {
  // Duration scales with text length (bounded), so long replies stream long enough for a
  // barge-in to interrupt and short confirmations finish fast. Deterministic per input.
  const chunks = Math.max(4, Math.min(64, Math.ceil(text.length / 8)));
  const frequencyHz = lang === 'en' ? 523 : 440; // audibly distinct per family, still fake
  if (signal.aborted) return;
  yield wavHeader(chunks * TONE_CHUNK_SAMPLES * 2);
  for (let i = 0; i < chunks; i++) {
    await delay(INTER_CHUNK_DELAY_MS);
    if (signal.aborted) return;
    yield toneChunk(i, frequencyHz);
  }
}
