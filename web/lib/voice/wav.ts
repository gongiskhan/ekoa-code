/**
 * WAV container parsing + stream segmentation (BRIEF §5 mobile/iOS checklist, run
 * 20260717-190134, slice C5). Pure byte work, no Web Audio, no DOM - fully unit-testable.
 *
 * Why: the tts-stream relay synthesizes PER SENTENCE (C5 text pipeline), so one spoken turn
 * arrives as several complete WAV files streamed back-to-back as binary WS frames, with frame
 * boundaries falling anywhere. iOS Safari playback requires decoding each sentence as its own
 * well-formed file into an AudioBufferSourceNode (MediaElementSource plays SILENT on mobile
 * Safari), so the client must (a) validate headers strictly and (b) split the byte stream
 * back into complete files. A well-formed RIFF header declares its total length (8 + the
 * RIFF chunk size), which makes segmentation deterministic - no sniffing, no wire change.
 * Sample rate is READ from each header, never assumed (the checklist rule: never hardcode).
 */

export interface WavInfo {
  /** PCM = 1; IEEE float = 3. Anything else is refused as malformed for our purposes. */
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** Byte offset of the data chunk's payload within the file. */
  dataOffset: number;
  /** Declared byte length of the data chunk payload. */
  dataLength: number;
  /** Declared total file length: 8 + RIFF chunk size. */
  totalLength: number;
}

const ascii = (bytes: Uint8Array, offset: number, len: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + len));

const u32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) + bytes[offset + 3] * 0x1000000;

const u16 = (bytes: Uint8Array, offset: number): number => bytes[offset] | (bytes[offset + 1] << 8);

/**
 * Parse and validate a WAV header (iOS Safari strict: RIFF/WAVE magic, a PCM/float fmt chunk
 * BEFORE data, sane rates, sizes that fit the declared file). Walks unknown chunks (LIST,
 * fact, ...) rather than assuming the canonical 44-byte layout. Returns null on anything
 * malformed - including the streaming-size placeholders (0 / 0xFFFFFFFF) some encoders emit,
 * which the checklist's "well-formed WAV headers" rule forbids on this wire.
 */
export function parseWavHeader(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44) return null;
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;
  const riffSize = u32(bytes, 4);
  if (riffSize < 36 || riffSize === 0xffffffff) return null;
  const totalLength = 8 + riffSize;

  let offset = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  // Chunk walk within what we have; header chunks precede data in a well-formed file.
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = u32(bytes, offset + 4);
    if (id === 'fmt ') {
      if (size < 16 || offset + 8 + 16 > bytes.length) return null;
      const audioFormat = u16(bytes, offset + 8);
      const channels = u16(bytes, offset + 10);
      const sampleRate = u32(bytes, offset + 12);
      const bitsPerSample = u16(bytes, offset + 22);
      if (audioFormat !== 1 && audioFormat !== 3) return null;
      if (channels < 1 || channels > 8) return null;
      if (sampleRate < 8_000 || sampleRate > 192_000) return null;
      if (![8, 16, 24, 32].includes(bitsPerSample)) return null;
      fmt = { audioFormat, channels, sampleRate, bitsPerSample };
    } else if (id === 'data') {
      if (!fmt) return null; // fmt must precede data
      if (size === 0xffffffff) return null; // streaming placeholder: not well-formed
      const dataOffset = offset + 8;
      if (dataOffset + size > totalLength) return null; // data cannot overrun the file
      return { ...fmt, dataOffset, dataLength: size, totalLength };
    }
    // Chunks are word-aligned: odd sizes carry one pad byte.
    offset += 8 + size + (size % 2);
  }
  return null; // no data chunk in what we were given
}

/** How many bytes of a file must be buffered before its declared total length is known. */
const RIFF_PREFIX = 8;

export type SegmenterError = 'not-riff' | 'bad-header';

/**
 * Reassembles complete WAV files out of an arbitrary byte-chunk stream (WS frames split
 * anywhere: mid-header, mid-file, several files in one frame). push() returns every file
 * completed by that chunk, in order. A malformed prefix poisons the segmenter (onError fires
 * once; further input is dropped) until reset() - the barge-in/turn-boundary flush.
 */
export class WavStreamSegmenter {
  private buffer = new Uint8Array(0);
  private errored: SegmenterError | null = null;

  constructor(private readonly onError?: (err: SegmenterError) => void) {}

  get error(): SegmenterError | null {
    return this.errored;
  }

  /** Bytes buffered toward a not-yet-complete file (0 when idle). */
  get pendingBytes(): number {
    return this.buffer.length;
  }

  push(chunk: Uint8Array): Uint8Array[] {
    if (this.errored) return [];
    if (chunk.length === 0) return [];
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer, 0);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;

    const complete: Uint8Array[] = [];
    for (;;) {
      if (this.buffer.length < RIFF_PREFIX) break;
      if (ascii(this.buffer, 0, 4) !== 'RIFF') {
        this.fail('not-riff');
        return complete;
      }
      const riffSize = u32(this.buffer, 4);
      if (riffSize < 36 || riffSize === 0xffffffff) {
        this.fail('bad-header');
        return complete;
      }
      const total = 8 + riffSize;
      if (this.buffer.length < total) break;
      // Slice one complete file out (copy - the buffer is reused).
      complete.push(this.buffer.slice(0, total));
      this.buffer = this.buffer.slice(total);
    }
    return complete;
  }

  /** Drop everything buffered and clear any error - the barge-in / new-turn flush. */
  reset(): void {
    this.buffer = new Uint8Array(0);
    this.errored = null;
  }

  private fail(err: SegmenterError): void {
    this.errored = err;
    this.buffer = new Uint8Array(0);
    this.onError?.(err);
  }
}
