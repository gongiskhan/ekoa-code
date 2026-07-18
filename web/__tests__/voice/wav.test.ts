// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseWavHeader, WavStreamSegmenter } from '@/lib/voice/wav';

/**
 * C5 (mega-run 20260717-190134): WAV parsing + stream segmentation for the TTS playback
 * path. Pure byte work, zero mocks. The relay streams one complete WAV per SENTENCE with WS
 * frame boundaries falling anywhere, so the segmenter must reassemble files byte-exactly;
 * the parser enforces the iOS-strict "well-formed WAV headers" checklist rule.
 */

/** Build a well-formed linear16 WAV (mirrors the relay stub's container shape). */
function makeWav(dataLength: number, sampleRate = 16_000, channels = 1, bits = 16): Uint8Array {
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
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, (sampleRate * channels * bits) / 8, true);
  dv.setUint16(32, (channels * bits) / 8, true);
  dv.setUint16(34, bits, true);
  ascii(36, 'data');
  dv.setUint32(40, dataLength, true);
  for (let i = 0; i < dataLength; i++) bytes[44 + i] = i % 251;
  return bytes;
}

describe('parseWavHeader', () => {
  it('parses a canonical 44-byte header, reading the rate from the FILE (never assumed)', () => {
    const info = parseWavHeader(makeWav(320, 48_000, 2, 16));
    expect(info).toMatchObject({
      audioFormat: 1,
      channels: 2,
      sampleRate: 48_000,
      bitsPerSample: 16,
      dataOffset: 44,
      dataLength: 320,
      totalLength: 44 + 320,
    });
    // A different rate is read as-is: nothing in the parser prefers 16 kHz.
    expect(parseWavHeader(makeWav(100, 22_050))?.sampleRate).toBe(22_050);
  });

  it('walks extra chunks between fmt and data (word-aligned, odd sizes padded)', () => {
    const base = makeWav(10);
    // Splice a 5-byte LIST chunk (odd -> 1 pad byte) between fmt and data.
    const extra = new Uint8Array(8 + 5 + 1);
    const dv = new DataView(extra.buffer);
    for (let i = 0; i < 4; i++) extra[i] = 'LIST'.charCodeAt(i);
    dv.setUint32(4, 5, true);
    const out = new Uint8Array(base.length + extra.length);
    out.set(base.subarray(0, 36), 0);
    out.set(extra, 36);
    out.set(base.subarray(36), 36 + extra.length);
    new DataView(out.buffer).setUint32(4, out.length - 8, true); // fix RIFF size
    const info = parseWavHeader(out);
    expect(info?.dataOffset).toBe(36 + extra.length + 8);
    expect(info?.dataLength).toBe(10);
  });

  it('rejects malformed input: short, bad magic, placeholder sizes, data overrun, bad fmt', () => {
    expect(parseWavHeader(new Uint8Array(20))).toBeNull();
    const badMagic = makeWav(10);
    badMagic[0] = 0x58; // 'X'IFF
    expect(parseWavHeader(badMagic)).toBeNull();

    const placeholderRiff = makeWav(10);
    new DataView(placeholderRiff.buffer).setUint32(4, 0xffffffff, true);
    expect(parseWavHeader(placeholderRiff)).toBeNull();

    const placeholderData = makeWav(10);
    new DataView(placeholderData.buffer).setUint32(40, 0xffffffff, true);
    expect(parseWavHeader(placeholderData)).toBeNull();

    const overrun = makeWav(10);
    new DataView(overrun.buffer).setUint32(40, 10_000, true); // data larger than the file
    expect(parseWavHeader(overrun)).toBeNull();

    const badBits = makeWav(10, 16_000, 1, 16);
    new DataView(badBits.buffer).setUint16(34, 12, true);
    expect(parseWavHeader(badBits)).toBeNull();

    const badRate = makeWav(10, 16_000);
    new DataView(badRate.buffer).setUint32(24, 1_000, true);
    expect(parseWavHeader(badRate)).toBeNull();
  });
});

describe('WavStreamSegmenter', () => {
  it('reassembles one file streamed byte by byte (frame boundaries anywhere)', () => {
    const wav = makeWav(50);
    const seg = new WavStreamSegmenter();
    const out: Uint8Array[] = [];
    for (let i = 0; i < wav.length; i++) out.push(...seg.push(wav.subarray(i, i + 1)));
    expect(out.length).toBe(1);
    expect(Array.from(out[0])).toEqual(Array.from(wav));
    expect(seg.pendingBytes).toBe(0);
  });

  it('splits several files arriving in one push, and across pushes mid-header', () => {
    const a = makeWav(20, 16_000);
    const b = makeWav(30, 48_000);
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a, 0);
    joined.set(b, a.length);

    const one = new WavStreamSegmenter();
    const got = one.push(joined);
    expect(got.length).toBe(2);
    expect(parseWavHeader(got[0])?.sampleRate).toBe(16_000);
    expect(parseWavHeader(got[1])?.sampleRate).toBe(48_000);

    // Split in the middle of b's header.
    const two = new WavStreamSegmenter();
    const first = two.push(joined.subarray(0, a.length + 6));
    expect(first.length).toBe(1);
    const second = two.push(joined.subarray(a.length + 6));
    expect(second.length).toBe(1);
    expect(Array.from(second[0])).toEqual(Array.from(b));
  });

  it('poisons on a non-RIFF prefix (error once, input dropped) until reset()', () => {
    const errors: string[] = [];
    const seg = new WavStreamSegmenter((e) => errors.push(e));
    expect(seg.push(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual([]);
    expect(errors).toEqual(['not-riff']);
    expect(seg.error).toBe('not-riff');
    // Further input is dropped, no second error.
    expect(seg.push(makeWav(10))).toEqual([]);
    expect(errors.length).toBe(1);
    // reset() recovers (the barge-in / new-turn flush).
    seg.reset();
    expect(seg.error).toBeNull();
    expect(seg.push(makeWav(10)).length).toBe(1);
  });

  it('rejects a streaming-placeholder RIFF size as bad-header', () => {
    const errors: string[] = [];
    const seg = new WavStreamSegmenter((e) => errors.push(e));
    const bad = makeWav(10);
    new DataView(bad.buffer).setUint32(4, 0xffffffff, true);
    expect(seg.push(bad)).toEqual([]);
    expect(errors).toEqual(['bad-header']);
  });

  it('reset() drops a partial file buffered toward completion', () => {
    const seg = new WavStreamSegmenter();
    const wav = makeWav(100);
    seg.push(wav.subarray(0, 60));
    expect(seg.pendingBytes).toBe(60);
    seg.reset();
    expect(seg.pendingBytes).toBe(0);
    // A fresh complete file still parses after the flush.
    expect(seg.push(wav).length).toBe(1);
  });
});
