/**
 * R-C1 — STT provider interface gate. Ported from cortex/tests/services/stt-provider.test.ts.
 * Adapted harness: the billing tracker is the injected usage-recorder seam (billing/
 * lands in its own phase), so metering is asserted via an injected spy instead of
 * vi.mock; STT_TOKENS_PER_MINUTE comes from legal/transcricao. Figures carried verbatim.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSttProvider,
  listSttProviders,
  meterStt,
  MOCK_FIXTURE_SEGMENTS,
  STT_TOKENS_PER_MINUTE,
  type SttUsageRecorder,
} from '../../src/legal/transcricao.js';

const recorded: Array<Record<string, unknown>> = [];
const record: SttUsageRecorder = (params) => {
  recorded.push(params as Record<string, unknown>);
};

beforeEach(() => {
  recorded.length = 0;
  delete process.env.EKOA_STT_WHISPERX_URL;
  delete process.env.EKOA_STT_ELEVENLABS_API_KEY;
});

describe('stt-provider — engines behind one interface', () => {
  it('mock transcribes deterministically: PT-PT, 2 speakers, word-level timestamps', async () => {
    const p = await getSttProvider('mock');
    expect(p.engine).toBe('mock');
    const r1 = await p.transcribe(Buffer.from('audio'), {});
    const r2 = await p.transcribe(Buffer.from('other'), {});
    expect(r1).toEqual(r2); // deterministic
    expect(r1.language).toBe('pt-PT');
    expect(new Set(r1.segments.map((s) => s.speaker)).size).toBe(2);
    for (const s of r1.segments) {
      expect(s.words.length).toBeGreaterThan(0);
      expect(s.words[0]!.start).toBeCloseTo(s.start, 5);
      for (const w of s.words) expect(w.end).toBeGreaterThanOrEqual(w.start);
    }
    // returned segments are copies — mutating them cannot corrupt the fixture
    r1.segments[0]!.words[0]!.w = 'MUTADO';
    expect(MOCK_FIXTURE_SEGMENTS[0]!.words[0]!.w).toBe('Declaro');
  });

  it('default posture resolution: whisperx unavailable pre-checkpoint -> falls back to mock', async () => {
    const p = await getSttProvider();
    expect(p.engine).toBe('mock');
  });

  it('whisperx stub reports the GPU checkpoint item as the honest reason', async () => {
    const wx = listSttProviders().find((p) => p.engine === 'whisperx')!;
    const a = await wx.available();
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/GPU|item #13/i);
  });

  it('elevenlabs REFUSES without explicit per-matter cloud consent (RGPD), even with a key', async () => {
    process.env.EKOA_STT_ELEVENLABS_API_KEY = 'k';
    const el = listSttProviders().find((p) => p.engine === 'elevenlabs')!;
    await expect(el.transcribe(Buffer.from('a'), {})).rejects.toThrow(/consentimento/i);
    await expect(el.transcribe(Buffer.from('a'), { consentCloud: false })).rejects.toThrow(/consentimento/i);
  });

  it('elevenlabs without key is unavailable citing checkpoint item #14', async () => {
    const el = listSttProviders().find((p) => p.engine === 'elevenlabs')!;
    const a = await el.available();
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/item #14|chave API/i);
  });
});

describe('stt metering — one internal currency (§3.4)', () => {
  it('meters stt:<engine> per STARTED minute at STT_TOKENS_PER_MINUTE', async () => {
    const tokens = await meterStt(
      { userId: 'u1', sessionId: 's1', engine: 'mock', durationSec: 181.2, artifactId: 'legal-transcricao' },
      record,
    );
    expect(tokens).toBe(4 * STT_TOKENS_PER_MINUTE);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      userId: 'u1',
      sessionId: 's1',
      agentType: 'stt:mock',
      inputTokens: 4 * STT_TOKENS_PER_MINUTE,
      outputTokens: 0,
      artifactId: 'legal-transcricao',
    });
  });

  it('sub-minute audio meters as one full minute (floor billing unit)', async () => {
    const tokens = await meterStt({ userId: 'u', sessionId: 's', engine: 'whisperx', durationSec: 12 }, record);
    expect(tokens).toBe(STT_TOKENS_PER_MINUTE);
    expect(recorded[0]).toMatchObject({ agentType: 'stt:whisperx' });
  });
});
