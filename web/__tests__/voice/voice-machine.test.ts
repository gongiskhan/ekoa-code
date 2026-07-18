// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  initialState,
  reduce,
  type VoiceEffect,
  type VoiceEvent,
  type VoiceState,
} from '@/lib/voice/voice-machine';

/**
 * C3 (mega-run 20260717-190134): the pure voice reducer. Zero mocks BY CONSTRAINT (BRIEF §5
 * validation: "Node, zero mocks - keep it that way"): the reducer owns no timers, sockets or
 * DOM - effects are descriptors the host runs - so every path here is exercised by feeding
 * events and asserting on {state, effects} alone.
 */

/** Deep-freeze so any in-reducer mutation of the input state throws (purity guard). */
function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as object)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}

/** Fold events through the reducer from a (frozen) state, collecting all effects. */
function run(state: VoiceState, ...events: VoiceEvent[]): { state: VoiceState; effects: VoiceEffect[] } {
  let s = state;
  const effects: VoiceEffect[] = [];
  for (const e of events) {
    const r = reduce(deepFreeze(s), e);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
}

const types = (effects: VoiceEffect[]) => effects.map((e) => e.type);

/** Drive a talking-mode machine to the given point of a turn. */
function talkingAt(point: 'listening' | 'capturing' | 'sending' | 'awaiting' | 'speaking' | 'standby'): VoiceState {
  const script: Record<string, VoiceEvent[]> = {
    listening: [{ type: 'tapMic' }],
    capturing: [{ type: 'tapMic' }, { type: 'speechCandidate' }, { type: 'speechConfirmed' }],
    sending: [
      { type: 'tapMic' }, { type: 'speechCandidate' }, { type: 'speechConfirmed' },
      { type: 'interim', text: 'qual é o prazo' }, { type: 'utteranceEnd', eot: 1 }, { type: 'sendNow' },
    ],
    awaiting: [
      { type: 'tapMic' }, { type: 'speechCandidate' }, { type: 'speechConfirmed' },
      { type: 'interim', text: 'qual é o prazo' }, { type: 'utteranceEnd', eot: 1 }, { type: 'sendNow' },
      { type: 'replyStarted' },
    ],
    speaking: [
      { type: 'tapMic' }, { type: 'speechCandidate' }, { type: 'speechConfirmed' },
      { type: 'interim', text: 'qual é o prazo' }, { type: 'utteranceEnd', eot: 1 }, { type: 'sendNow' },
      { type: 'replyStarted' }, { type: 'ttsFirstAudio' },
    ],
    standby: [
      { type: 'tapMic' }, { type: 'speechCandidate' }, { type: 'speechConfirmed' },
      { type: 'interim', text: 'qual é o prazo' }, { type: 'utteranceEnd', eot: 1 }, { type: 'sendNow' },
      { type: 'agentBusy' },
    ],
  };
  return run(initialState('talking'), ...script[point]).state;
}

describe('voice-machine: purity and shape', () => {
  it('reduce never mutates the input state (deep-frozen inputs across a full turn)', () => {
    const { state } = run(
      initialState('talking'),
      { type: 'tapMic' },
      { type: 'speechCandidate' },
      { type: 'speechConfirmed' },
      { type: 'interim', text: 'olá' },
      { type: 'utteranceEnd', eot: null },
      { type: 'sendNow' },
      { type: 'replyStarted' },
      { type: 'replyTextChunk', text: 'Bom dia.' },
      { type: 'ttsFirstAudio' },
      { type: 'agentDone' },
    );
    expect(state.status).toBe('listening');
  });

  it('a no-op event returns the same state reference', () => {
    const s = initialState('manual');
    const r = reduce(s, { type: 'speechConfirmed' });
    expect(r.state).toBe(s);
    expect(r.effects).toEqual([]);
  });

  it('initialState merges partial config over the defaults', () => {
    const s = initialState('talking', { confirmMs: 250, grace: { minMs: 1000, maxMs: 4000 } });
    expect(s.config.confirmMs).toBe(250);
    expect(s.config.grace).toEqual({ minMs: 1000, maxMs: 4000 });
    expect(s.config.inactivityTickLimit).toBe(10);
  });
});

describe('voice-machine: manual mode', () => {
  it('tapMic from idle opens capture directly (no VAD loop) with stream + audio_in mark', () => {
    const r = run(initialState('manual'), { type: 'tapMic' });
    expect(r.state.status).toBe('capturing');
    expect(types(r.effects)).toEqual(['openSttStream', 'sendAudio', 'emitLatencyMark']);
  });

  it('tap-stop ends capture, keeps the transcript, closes the stream, does NOT send', () => {
    const r = run(
      initialState('manual'),
      { type: 'tapMic' },
      { type: 'interim', text: 'redige o email' },
      { type: 'utteranceEnd', eot: null },
      { type: 'tapMic' },
    );
    expect(r.state.status).toBe('idle');
    expect(r.state.transcript).toBe('redige o email');
    expect(types(r.effects)).toContain('closeStt');
  });

  it('send stays explicit: sendNow after tap-stop moves the kept transcript to sending', () => {
    const stopped = run(
      initialState('manual'),
      { type: 'tapMic' },
      { type: 'interim', text: 'redige o email' },
      { type: 'tapMic' },
    ).state;
    const r = run(stopped, { type: 'sendNow' });
    expect(r.state.status).toBe('sending');
    expect(r.state.transcript).toBe('redige o email');
  });

  it('sendNow straight from capturing folds the interim, closes the stream and sends', () => {
    const r = run(
      initialState('manual'),
      { type: 'tapMic' },
      { type: 'interim', text: 'qual é o prazo' },
      { type: 'sendNow' },
    );
    expect(r.state.status).toBe('sending');
    expect(r.state.transcript).toBe('qual é o prazo');
    expect(types(r.effects)).toContain('closeStt');
  });

  it('sendNow in idle with no transcript is a no-op', () => {
    const s = initialState('manual');
    expect(reduce(s, { type: 'sendNow' }).state).toBe(s);
  });

  it('reply chunks are NEVER spoken in manual mode (read aloud only on demand)', () => {
    const sending = run(
      initialState('manual'),
      { type: 'tapMic' },
      { type: 'interim', text: 'olá' },
      { type: 'sendNow' },
    ).state;
    const r = run(sending, { type: 'replyStarted' }, { type: 'replyTextChunk', text: 'Bom dia.' });
    expect(r.state.status).toBe('awaiting');
    expect(types(r.effects)).not.toContain('say');
  });

  it('agentDone returns manual mode to idle', () => {
    const sending = run(
      initialState('manual'),
      { type: 'tapMic' },
      { type: 'interim', text: 'olá' },
      { type: 'sendNow' },
    ).state;
    const r = run(sending, { type: 'replyStarted' }, { type: 'agentDone' });
    expect(r.state.status).toBe('idle');
  });

  it('tapMic while the agent works is ignored in manual mode', () => {
    const sending = run(
      initialState('manual'),
      { type: 'tapMic' },
      { type: 'interim', text: 'olá' },
      { type: 'sendNow' },
    ).state;
    const r = reduce(sending, { type: 'tapMic' });
    expect(r.state.status).toBe('sending');
    expect(r.effects).toEqual([]);
  });
});

describe('voice-machine: talking mode loop', () => {
  it('one tap arms the hands-free loop: listening, stream open, frames flowing (ungated v1)', () => {
    const r = run(initialState('talking'), { type: 'tapMic' });
    expect(r.state.status).toBe('listening');
    expect(r.effects).toEqual([
      { type: 'openSttStream' },
      { type: 'sendAudio' },
      { type: 'emitLatencyMark', mark: 'audio_in' },
    ]);
  });

  it('a second tap anywhere in the loop exits it and closes the stream', () => {
    const r = run(talkingAt('listening'), { type: 'tapMic' });
    expect(r.state.status).toBe('idle');
    expect(types(r.effects)).toContain('closeStt');
  });

  it('a second tap during speaking also clears TTS', () => {
    const r = run(talkingAt('speaking'), { type: 'tapMic' });
    expect(r.state.status).toBe('idle');
    expect(types(r.effects)).toEqual(expect.arrayContaining(['closeStt', 'clearTts']));
  });

  it('utteranceEnd schedules the adaptive grace window and marks utterance_end', () => {
    const r = run(talkingAt('capturing'), { type: 'interim', text: 'já terminei.' }, { type: 'utteranceEnd', eot: 1 });
    expect(r.state.transcript).toBe('já terminei.');
    expect(r.state.graceArmed).toBe(true);
    expect(r.effects).toContainEqual({ type: 'scheduleGraceWindow', ms: 1500 });
    expect(r.effects).toContainEqual({ type: 'emitLatencyMark', mark: 'utterance_end' });
  });

  it('mid-thought eot stretches the grace window to the max', () => {
    const r = run(talkingAt('capturing'), { type: 'interim', text: 'e depois' }, { type: 'utteranceEnd', eot: 0 });
    expect(r.effects).toContainEqual({ type: 'scheduleGraceWindow', ms: 6000 });
  });

  it('new interim text after utteranceEnd cancels the armed grace window (user resumed)', () => {
    const paused = run(talkingAt('capturing'), { type: 'interim', text: 'primeiro isto' }, { type: 'utteranceEnd', eot: null }).state;
    const r = run(paused, { type: 'interim', text: 'e mais uma coisa' });
    expect(types(r.effects)).toContain('cancelGraceWindow');
    expect(r.state.graceArmed).toBe(false);
  });

  it('speechCandidate during an armed grace window also cancels it', () => {
    const paused = run(talkingAt('capturing'), { type: 'interim', text: 'primeiro isto' }, { type: 'utteranceEnd', eot: null }).state;
    const r = run(paused, { type: 'speechCandidate' });
    expect(r.state.status).toBe('capturing');
    expect(types(r.effects)).toEqual(['cancelGraceWindow']);
  });

  it('sendNow (grace expiry or the escape-hatch tap) sends the turn and arms standby dormancy', () => {
    const r = run(talkingAt('capturing'), { type: 'interim', text: 'qual é o prazo' }, { type: 'utteranceEnd', eot: 1 }, { type: 'sendNow' });
    expect(r.state.status).toBe('sending');
    expect(r.state.transcript).toBe('qual é o prazo');
    expect(r.state.micDormant).toBe(true);
    expect(types(r.effects)).toContain('armStandby');
  });

  it('an empty grace-window expiry re-arms listening instead of sending nothing', () => {
    const r = run(talkingAt('capturing'), { type: 'sendNow' });
    expect(r.state.status).toBe('listening');
    expect(r.effects).toEqual([]);
  });

  it('a full turn: multiple utterances accumulate, reply streams to TTS, loop re-arms', () => {
    const r = run(
      talkingAt('capturing'),
      { type: 'interim', text: 'qual é o prazo' },
      { type: 'utteranceEnd', eot: null },
      { type: 'interim', text: 'do processo' },
      { type: 'utteranceEnd', eot: 1 },
      { type: 'sendNow' },
      { type: 'replyStarted' },
      { type: 'replyTextChunk', text: 'O prazo é dia 16.' },
      { type: 'ttsFirstAudio' },
      { type: 'agentDone' },
    );
    expect(r.state.status).toBe('listening');
    expect(types(r.effects)).toContain('say');
    expect(r.effects).toContainEqual({ type: 'say', text: 'O prazo é dia 16.' });
    // Re-arm after a dormant turn resumes the frames.
    expect(types(r.effects.slice(-1))).toEqual(['sendAudio']);
  });

  it('latency marks cover the BRIEF dashboard points once per turn', () => {
    const r = run(
      initialState('talking'),
      { type: 'tapMic' },
      { type: 'speechCandidate' },
      { type: 'speechConfirmed' },
      { type: 'interim', text: 'olá' },
      { type: 'interim', text: 'olá bom dia' },
      { type: 'utteranceEnd', eot: 1 },
      { type: 'sendNow' },
      { type: 'replyStarted' },
      { type: 'ttsFirstAudio' },
    );
    const marks = r.effects.filter((e) => e.type === 'emitLatencyMark').map((e) => e.mark);
    expect(marks).toEqual(['audio_in', 'first_interim', 'utterance_end', 'agent_first_token', 'tts_first_audio']);
  });
});

describe('voice-machine: confirmation gate (~300 ms sustained)', () => {
  it('speechCandidate in listening opens the gate with the configured timer', () => {
    const r = run(talkingAt('listening'), { type: 'speechCandidate' });
    expect(r.state.status).toBe('confirming');
    expect(r.effects).toEqual([{ type: 'startConfirmationTimer', ms: 300 }]);
  });

  it('the timer length follows config.confirmMs', () => {
    const s = run(initialState('talking', { confirmMs: 450 }), { type: 'tapMic' }).state;
    const r = run(s, { type: 'speechCandidate' });
    expect(r.effects).toEqual([{ type: 'startConfirmationTimer', ms: 450 }]);
  });

  it('sustained speech confirms into a fresh turn capture', () => {
    const r = run(talkingAt('listening'), { type: 'speechCandidate' }, { type: 'speechConfirmed' });
    expect(r.state.status).toBe('capturing');
    expect(r.state.noteCapture).toBe(false);
  });

  it('a short burst cancels back to where the candidate came from', () => {
    const r = run(talkingAt('listening'), { type: 'speechCandidate' }, { type: 'speechCancelled' });
    expect(r.state.status).toBe('listening');
  });

  it('a cancelled candidate during TTS returns to speaking without clearing playback', () => {
    const r = run(talkingAt('speaking'), { type: 'speechCandidate' }, { type: 'speechCancelled' });
    expect(r.state.status).toBe('speaking');
    expect(types(r.effects)).not.toContain('clearTts');
  });

  it('speechConfirmed outside the gate is a no-op', () => {
    const s = talkingAt('listening');
    expect(reduce(s, { type: 'speechConfirmed' }).state).toBe(s);
  });
});

describe('voice-machine: barge-in', () => {
  it('a confirmed candidate during TTS clears playback, WAKES the mic, and opens a new turn capture', () => {
    const r = run(talkingAt('speaking'), { type: 'speechCandidate' }, { type: 'speechConfirmed' });
    expect(r.state.status).toBe('capturing');
    // Regression (C3 review): armStandby paused frames during TTS; the barge-in capture MUST
    // re-open audio, else STT hears nothing and the turn stalls.
    expect(r.state.micDormant).toBe(false);
    expect(types(r.effects)).toContain('clearTts');
    expect(r.effects).toContainEqual({ type: 'sendAudio' });
    expect(r.effects).toContainEqual({ type: 'emitLatencyMark', mark: 'barge_in' });
  });

  it('bargeInDetected during speaking clears TTS, wakes the mic, and streams audio (host-confirmed path)', () => {
    const r = run(talkingAt('speaking'), { type: 'bargeInDetected' });
    expect(r.state.status).toBe('capturing');
    expect(r.state.micDormant).toBe(false);
    expect(types(r.effects)).toEqual(expect.arrayContaining(['clearTts', 'sendAudio', 'emitLatencyMark']));
  });

  it('speech starting during sending (pre-reply) opens a note capture, not a dropped event', () => {
    const r = run(talkingAt('sending'), { type: 'speechCandidate' }, { type: 'speechConfirmed' });
    expect(r.state.status).toBe('capturing');
    expect(r.state.noteCapture).toBe(true);
    expect(r.state.micDormant).toBe(false);
    expect(r.effects).toContainEqual({ type: 'sendAudio' });
  });

  it('barge-in capture then utteranceEnd + sendNow starts the next turn normally', () => {
    const r = run(
      talkingAt('speaking'),
      { type: 'bargeInDetected' },
      { type: 'interim', text: 'espera, muda a data' },
      { type: 'utteranceEnd', eot: 1 },
      { type: 'sendNow' },
    );
    expect(r.state.status).toBe('sending');
    expect(r.state.transcript).toBe('espera, muda a data');
  });

  it('bargeInDetected while idle is a no-op', () => {
    const s = initialState('talking');
    expect(reduce(s, { type: 'bargeInDetected' }).state).toBe(s);
  });
});

describe('voice-machine: standby + pending note', () => {
  it('agentBusy arms standby: mic dormant but conceptually alive', () => {
    const r = run(talkingAt('sending'), { type: 'agentBusy' });
    expect(r.state.status).toBe('standby');
    expect(r.state.micDormant).toBe(true);
  });

  it('armStandby is not re-emitted when the mic is already dormant (talking sendNow armed it)', () => {
    // talkingAt('sending') went through sendNow, which already emitted armStandby.
    const r = run(talkingAt('sending'), { type: 'agentBusy' });
    expect(types(r.effects)).not.toContain('armStandby');
  });

  it('agentBusy from speaking (opening status line, then long task) also enters standby', () => {
    const spoken = run(talkingAt('speaking'), { type: 'agentDone' }).state; // drain first turn
    const busy = run(
      spoken,
      { type: 'speechCandidate' },
      { type: 'speechConfirmed' },
      { type: 'interim', text: 'trata disso' },
      { type: 'utteranceEnd', eot: 1 },
      { type: 'sendNow' },
      { type: 'replyStarted' },
      { type: 'ttsFirstAudio' },
      { type: 'agentBusy' },
    );
    expect(busy.state.status).toBe('standby');
  });

  it('confirmed speech during standby captures a pending note, waking the frames', () => {
    const r = run(talkingAt('standby'), { type: 'speechCandidate' }, { type: 'speechConfirmed' });
    expect(r.state.status).toBe('capturing');
    expect(r.state.noteCapture).toBe(true);
    expect(types(r.effects)).toContain('sendAudio');
  });

  it('the finished note is appended to the running turn and standby re-arms', () => {
    const r = run(
      talkingAt('standby'),
      { type: 'bargeInDetected' },
      { type: 'interim', text: 'e verifica também o prazo X' },
      { type: 'utteranceEnd', eot: null },
    );
    expect(r.state.status).toBe('standby');
    expect(r.state.micDormant).toBe(true);
    expect(r.effects).toContainEqual({ type: 'appendPendingNote', text: 'e verifica também o prazo X' });
    expect(types(r.effects.slice(-1))).toEqual(['armStandby']);
  });

  it('a note NEVER becomes a new turn: no grace window, no sending status', () => {
    const r = run(
      talkingAt('standby'),
      { type: 'bargeInDetected' },
      { type: 'interim', text: 'nota curta' },
      { type: 'utteranceEnd', eot: 1 },
    );
    expect(types(r.effects)).not.toContain('scheduleGraceWindow');
    expect(r.state.status).toBe('standby');
  });

  it('a silent note capture appends nothing', () => {
    const r = run(talkingAt('standby'), { type: 'bargeInDetected' }, { type: 'utteranceEnd', eot: null });
    expect(types(r.effects)).not.toContain('appendPendingNote');
    expect(r.state.status).toBe('standby');
  });

  it('an out-of-band pendingNote event appends directly from standby', () => {
    const r = run(talkingAt('standby'), { type: 'pendingNote', text: 'inclui o anexo B' });
    expect(r.effects).toEqual([{ type: 'appendPendingNote', text: 'inclui o anexo B' }]);
    expect(r.state.status).toBe('standby');
  });

  it('agentDone from standby re-arms listening in talking mode with frames resumed', () => {
    const r = run(talkingAt('standby'), { type: 'agentDone' });
    expect(r.state.status).toBe('listening');
    expect(types(r.effects)).toContain('sendAudio');
  });

  it('agentDone in manual mode lands idle', () => {
    const sending = run(
      initialState('manual'),
      { type: 'tapMic' },
      { type: 'interim', text: 'olá' },
      { type: 'sendNow' },
    ).state;
    const r = run(sending, { type: 'agentBusy' }, { type: 'agentDone' });
    expect(r.state.status).toBe('idle');
  });

  it('agentDone mid-note promotes the note capture into the start of the next turn', () => {
    const midNote = run(
      talkingAt('standby'),
      { type: 'bargeInDetected' },
      { type: 'interim', text: 'e mais uma coisa' },
    ).state;
    const r = run(midNote, { type: 'agentDone' });
    expect(r.state.status).toBe('capturing');
    expect(r.state.noteCapture).toBe(false);
    expect(r.state.interim).toBe('e mais uma coisa');
  });

  it('reply resuming from standby moves to awaiting and then speaking', () => {
    const r = run(talkingAt('standby'), { type: 'replyStarted' }, { type: 'ttsFirstAudio' });
    expect(r.state.status).toBe('speaking');
  });
});

describe('voice-machine: inactivity and close', () => {
  it('ticks accumulate in listening and shut the machine down at the limit', () => {
    let s = run(initialState('talking', { inactivityTickLimit: 3 }), { type: 'tapMic' }).state;
    s = run(s, { type: 'inactivityTick' }, { type: 'inactivityTick' }).state;
    expect(s.status).toBe('listening');
    const r = run(s, { type: 'inactivityTick' });
    expect(r.state.status).toBe('idle');
    expect(types(r.effects)).toContain('closeStt');
  });

  it('ticks also count down standby sessions', () => {
    let s = initialState('talking', { inactivityTickLimit: 2 });
    s = run(s, { type: 'tapMic' }, { type: 'speechCandidate' }, { type: 'speechConfirmed' },
      { type: 'interim', text: 'olá' }, { type: 'utteranceEnd', eot: 1 }, { type: 'sendNow' },
      { type: 'agentBusy' }, { type: 'inactivityTick' }).state;
    expect(s.status).toBe('standby');
    expect(run(s, { type: 'inactivityTick' }).state.status).toBe('idle');
  });

  it('any activity resets the inactivity counter', () => {
    let s = run(initialState('talking', { inactivityTickLimit: 2 }), { type: 'tapMic' }).state;
    s = run(s, { type: 'inactivityTick' }).state;
    expect(s.ticks).toBe(1);
    s = run(s, { type: 'speechCandidate' }, { type: 'speechCancelled' }).state;
    expect(s.ticks).toBe(0);
    expect(run(s, { type: 'inactivityTick' }).state.status).toBe('listening');
  });

  it('ticks are ignored while capturing (activity in progress)', () => {
    const s = talkingAt('capturing');
    const r = reduce(s, { type: 'inactivityTick' });
    expect(r.state.status).toBe('capturing');
    expect(r.state.ticks).toBe(0);
  });

  it('close tears down from anywhere; during speaking it also clears TTS', () => {
    const r = run(talkingAt('speaking'), { type: 'close' });
    expect(r.state.status).toBe('idle');
    expect(types(r.effects)).toEqual(expect.arrayContaining(['closeStt', 'clearTts']));
    const idle = reduce(initialState('talking'), { type: 'close' });
    expect(idle.state.status).toBe('idle');
    expect(idle.effects).toEqual([]);
  });
});
