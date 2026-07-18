// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { LatencyRecordCollector } from '@/lib/voice/latency-record';

/**
 * C7 (mega-run 20260717-190134): the client-side per-turn latency collector - folds the
 * five-plus-one marks C3/C4 already emit (audio_in -> first_interim -> utterance_end ->
 * agent_first_token -> tts_first_audio, plus barge_in) into ONE record per turn, mirroring the
 * server's per-turn stage clocks (api/src/voice/session.ts). Pure, zero mocks. Complements the
 * already-landed C3 reducer suite (voice-machine.test.ts) which proves the machine EMITS these
 * marks in order; this suite proves the collector FOLDS them correctly - not a duplicate.
 */
describe('LatencyRecordCollector', () => {
  it('a full talking-mode turn (audio_in -> first_interim -> utterance_end -> agent_first_token -> tts_first_audio) closes on tts_first_audio with every delta computed', () => {
    const c = new LatencyRecordCollector();
    expect(c.mark('audio_in', 1000)).toBeNull();
    expect(c.mark('first_interim', 1200)).toBeNull();
    expect(c.mark('utterance_end', 2500)).toBeNull();
    expect(c.mark('agent_first_token', 4000)).toBeNull();
    const record = c.mark('tts_first_audio', 4300);
    expect(record).toEqual({
      turn: 0,
      audio_in: 1000,
      first_interim: 1200,
      utterance_end: 2500,
      agent_first_token: 4000,
      tts_first_audio: 4300,
      barge_in: null,
      ms_to_first_interim: 200,
      ms_to_utterance_end: 1500,
      ms_to_agent_first_token: 3000,
      ms_to_tts_first_audio: 3300,
      interrupted: false,
    });
  });

  it('a manual-mode turn (no tts_first_audio) never closes on its own - the NEXT audio_in closes it, with tts fields null', () => {
    const c = new LatencyRecordCollector();
    c.mark('audio_in', 0);
    c.mark('first_interim', 100);
    c.mark('utterance_end', 900);
    expect(c.mark('agent_first_token', 1200)).toBeNull(); // still open - no tts follows in manual mode
    const closed = c.mark('audio_in', 5000); // the next turn opening closes the first
    expect(closed).toMatchObject({
      turn: 0,
      audio_in: 0,
      agent_first_token: 1200,
      tts_first_audio: null,
      ms_to_agent_first_token: 1200,
      ms_to_tts_first_audio: null,
      interrupted: false,
    });
  });

  it('barge-in during TTS: the interrupted turn already closed cleanly on its own tts_first_audio (reducer only emits barge_in from "speaking", i.e. after tts_first_audio); barge_in opens the NEXT turn, self-tagged', () => {
    const c = new LatencyRecordCollector();
    c.mark('audio_in', 0);
    c.mark('first_interim', 150);
    c.mark('utterance_end', 800);
    c.mark('agent_first_token', 1100);
    const firstClosed = c.mark('tts_first_audio', 1400); // turn 0 closes here, cleanly
    expect(firstClosed).toMatchObject({ turn: 0, tts_first_audio: 1400, barge_in: null, interrupted: false });

    // Nothing was open when the interruption landed (already closed above) - no record to
    // retroactively mutate; the collector never re-emits an already-logged record.
    expect(c.mark('barge_in', 3000)).toBeNull();

    // The interruption opened turn 1 AT that instant - both audio_in and barge_in read 3000,
    // so the dashboard can tell this turn was opened by an interruption, not a fresh tap.
    const second = c.mark('tts_first_audio', 3600);
    expect(second).toMatchObject({ turn: 1, audio_in: 3000, barge_in: 3000, tts_first_audio: 3600, ms_to_tts_first_audio: 600 });
  });

  it('a barge_in mark arriving while a turn is STILL open (defensive - the current reducer never actually reaches this) closes it flagged interrupted, then opens the next turn', () => {
    const c = new LatencyRecordCollector();
    c.mark('audio_in', 0);
    c.mark('agent_first_token', 500);
    const record = c.mark('barge_in', 800); // interrupted while still awaiting the reply
    expect(record).toMatchObject({ turn: 0, tts_first_audio: null, barge_in: 800, interrupted: true });
    const next = c.mark('tts_first_audio', 900);
    expect(next).toMatchObject({ turn: 1, audio_in: 800, barge_in: 800 });
  });

  it('a stray mark with no turn open is ignored (defensive - never throws, never fabricates a turn)', () => {
    const c = new LatencyRecordCollector();
    expect(c.mark('first_interim', 100)).toBeNull();
    expect(c.mark('tts_first_audio', 200)).toBeNull();
    // The collector is still pristine: a real turn afterward starts at turn 0.
    expect(c.mark('audio_in', 300)).toBeNull();
    expect(c.mark('tts_first_audio', 400)).toMatchObject({ turn: 0, audio_in: 300 });
  });

  it('close() force-flushes an open turn (session teardown) and is idempotent with nothing open', () => {
    const c = new LatencyRecordCollector();
    c.mark('audio_in', 10);
    c.mark('first_interim', 40);
    const flushed = c.close();
    expect(flushed).toMatchObject({ turn: 0, audio_in: 10, first_interim: 40, tts_first_audio: null });
    expect(c.close()).toBeNull();
  });

  it('turn numbers increment across a full session (0, 1, 2, ...)', () => {
    const c = new LatencyRecordCollector();
    c.mark('audio_in', 0);
    const t0 = c.mark('tts_first_audio', 100)!;
    c.mark('audio_in', 200);
    const t1 = c.mark('tts_first_audio', 300)!;
    c.mark('audio_in', 400);
    const t2 = c.close()!;
    expect([t0.turn, t1.turn, t2.turn]).toEqual([0, 1, 2]);
  });
});
