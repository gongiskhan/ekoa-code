// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { VoiceSttServerMessage } from '@ekoa/shared';
import {
  VoiceSessionDriver,
  type CaptureChainLike,
  type SpeechLike,
  type SttChannelLike,
  type TimerApi,
  type VadLike,
  type VoiceDriverHooks,
  type VoiceMode,
} from '@/lib/voice/session-driver';
import type { LatencyMark, VoiceState } from '@/lib/voice/voice-machine';

/**
 * C4 (mega-run 20260717-190134): the host driver end-to-end with INJECTED fakes - no mic,
 * no WebSocket, no Web Audio, no mock framework. Drives:
 *   - a full MANUAL turn (tap -> capture chain + stream open -> frames forwarded ->
 *     interims -> tap-stop leaves the transcript for the composer; explicit send-now path);
 *   - a full TALKING turn (tap -> listening -> VAD candidate -> ~300 ms confirmation ->
 *     capturing -> utterance_end -> adaptive grace window -> auto-send -> reply chunks
 *     stream to the speech channel as sentences -> speaking -> drain -> re-armed listening);
 *   - barge-in during TTS (candidate + confirmation -> clearTts + fresh capture);
 *   - standby + pending note through a long agent task;
 *   - inactivity shutdown and the latency-mark trail;
 *   - rapid toggling during the ASYNC open path (deferred permission/dial/VAD awaits):
 *     a deliberate stop mid-open tears down silently - no leaked resource, no error event,
 *     and a stale open never clobbers a newer session (the generation guard).
 */

/* ------------------------------------- fakes ------------------------------------- */

class FakeTimers implements TimerApi {
  private seq = 0;
  pending = new Map<number, { fn: () => void; ms: number }>();
  set(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.pending.set(id, { fn, ms });
    return id;
  }
  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  /** Fire the single pending timer matching a predicate (asserts exactly one). */
  fire(match: (ms: number) => boolean): void {
    const hits = [...this.pending.entries()].filter(([, t]) => match(t.ms));
    if (hits.length !== 1) {
      throw new Error(`expected exactly 1 matching timer, found ${hits.length}`);
    }
    const [id, timer] = hits[0];
    this.pending.delete(id);
    timer.fn();
  }
  msList(): number[] {
    return [...this.pending.values()].map((t) => t.ms);
  }
}

class FakeCapture implements CaptureChainLike {
  started = 0;
  stopped = 0;
  failNext = false;
  async start(): Promise<void> {
    if (this.failNext) throw new Error('denied');
    this.started += 1;
  }
  stop(): void {
    this.stopped += 1;
  }
  get context(): AudioContext | null {
    return null;
  }
  get stream(): MediaStream | null {
    return null;
  }
}

class FakeStt implements SttChannelLike {
  opens = 0;
  closes = 0;
  closeStreams = 0;
  audioFrames: ArrayBuffer[] = [];
  committed: Array<{ id: string; mode: VoiceMode }> = [];
  private open_ = false;
  async open(): Promise<void> {
    this.opens += 1;
    this.open_ = true;
  }
  sendAudio(frame: ArrayBuffer): void {
    this.audioFrames.push(frame);
  }
  sendCloseStream(): void {
    this.closeStreams += 1;
  }
  sendTurnCommitted(id: string, mode: VoiceMode): void {
    this.committed.push({ id, mode });
  }
  close(): void {
    this.closes += 1;
    this.open_ = false;
  }
  get isOpen(): boolean {
    return this.open_;
  }
}

class FakeSpeech implements SpeechLike {
  unlocks = 0;
  texts: string[] = [];
  flushes = 0;
  clears = 0;
  idleState = true;
  unlock(): void {
    this.unlocks += 1;
  }
  enqueueText(text: string): void {
    this.texts.push(text);
    this.idleState = false;
  }
  flushText(): void {
    this.flushes += 1;
  }
  clear(): void {
    this.clears += 1;
    this.idleState = true;
  }
  get idle(): boolean {
    return this.idleState;
  }
}

class FakeVad implements VadLike {
  speaking = false;
  destroyed = 0;
  destroy(): void {
    this.destroyed += 1;
  }
}

interface Harness {
  driver: VoiceSessionDriver;
  timers: FakeTimers;
  capture: FakeCapture;
  stt: FakeStt;
  speech: FakeSpeech;
  vad: FakeVad;
  sent: Array<{ text: string; mode: VoiceMode }>;
  notes: string[];
  errors: string[];
  marks: LatencyMark[];
  states: VoiceState[];
  /** Drain the microtask queue (capture/stt open are async). */
  settle: () => Promise<void>;
}

function makeHarness(mode: VoiceMode): Harness {
  const timers = new FakeTimers();
  const capture = new FakeCapture();
  const stt = new FakeStt();
  const speech = new FakeSpeech();
  const vad = new FakeVad();
  const sent: Array<{ text: string; mode: VoiceMode }> = [];
  const notes: string[] = [];
  const errors: string[] = [];
  const marks: LatencyMark[] = [];
  const states: VoiceState[] = [];
  const hooks: VoiceDriverHooks = {
    onStateChange: (s) => states.push(s),
    onLevel: () => undefined,
    onSendTranscript: (text, m) => sent.push({ text, mode: m }),
    onPendingNote: (text) => notes.push(text),
    onError: (code) => errors.push(code),
    onLatencyMark: (mark) => marks.push(mark),
  };
  const driver = new VoiceSessionDriver(mode, {
    capture,
    stt,
    speech,
    startVad: mode === 'talking' ? async () => vad : undefined,
    timers,
    hooks,
    config: { busyAfterMs: 2_500, inactivityTickMs: 60_000 },
  });
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { driver, timers, capture, stt, speech, vad, sent, notes, errors, marks, states, settle };
}

function srv(h: Harness, msg: VoiceSttServerMessage): void {
  h.driver.handleSttMessage(msg);
}

const interim = (text: string): VoiceSttServerMessage => ({
  type: 'transcript',
  text,
  isFinal: false,
  speechFinal: false,
});
const final = (text: string): VoiceSttServerMessage => ({
  type: 'transcript',
  text,
  isFinal: true,
  speechFinal: true,
});

/* ------------------------------------ manual mode ------------------------------------ */

describe('manual turn (tap -> dictate -> stop -> explicit send)', () => {
  it('opens the chain on tap, forwards frames, and tap-stop leaves the composer transcript', async () => {
    const h = makeHarness('manual');
    h.driver.tapMic();
    expect(h.speech.unlocks).toBe(1); // unlock synchronously inside the tap
    expect(h.driver.getState().status).toBe('capturing');
    expect(h.marks).toContain('audio_in');
    await h.settle();
    expect(h.capture.started).toBe(1);
    expect(h.stt.opens).toBe(1);

    // Frames forward while capturing (ungated v1: capture open = frames flowing).
    h.driver.handleFrame(new ArrayBuffer(8));
    expect(h.stt.audioFrames).toHaveLength(1);

    srv(h, interim('qual é'));
    expect(h.marks).toContain('first_interim');
    srv(h, final('Qual é o prazo do processo?'));
    expect(h.driver.getState().interim).toBe('Qual é o prazo do processo?');

    // Tap-stop: capture ends, transcript stays for the composer, stream closes.
    h.driver.tapMic();
    expect(h.driver.getState().status).toBe('idle');
    expect(h.stt.closes).toBe(1);
    expect(h.capture.stopped).toBeGreaterThan(0);
    expect(h.driver.takeTranscript()).toBe('Qual é o prazo do processo?');
    expect(h.driver.takeTranscript()).toBe(''); // taken exactly once
    expect(h.sent).toHaveLength(0); // manual send stays explicit
  });

  it('send-now while capturing sends the utterance as a message and closes the stream', async () => {
    const h = makeHarness('manual');
    h.driver.tapMic();
    await h.settle();
    srv(h, final('Envia isto ao cliente.'));
    h.driver.sendNow();
    expect(h.sent).toEqual([{ text: 'Envia isto ao cliente.', mode: 'manual' }]);
    expect(h.driver.getState().status).toBe('sending');
    expect(h.stt.closes).toBe(1);

    // The run settles with nothing to speak (manual never streams TTS): back to idle.
    h.driver.notifyRunSettled();
    expect(h.driver.getState().status).toBe('idle');
  });

  it('surfaces a denied mic and returns to idle', async () => {
    const h = makeHarness('manual');
    h.capture.failNext = true;
    h.driver.tapMic();
    await h.settle();
    expect(h.errors).toContain('MIC_DENIED');
    expect(h.driver.getState().status).toBe('idle');
  });
});

/* ------------------------------------ talking mode ------------------------------------ */

/** Arm a talking session up to confirmed capture of one utterance. */
async function talkThrough(h: Harness, utterance: string): Promise<void> {
  h.driver.tapMic();
  await h.settle();
  expect(h.driver.getState().status).toBe('listening');

  h.vad.speaking = true;
  h.driver.handleVadSpeechStart();
  expect(h.driver.getState().status).toBe('confirming');
  h.timers.fire((ms) => ms === 300); // the ~300 ms confirmation gate
  expect(h.driver.getState().status).toBe('capturing');

  srv(h, interim(utterance.slice(0, 5)));
  srv(h, final(utterance));
  h.vad.speaking = false;
  h.driver.handleVadSpeechEnd();
  srv(h, { type: 'utterance_end', transcript: utterance });
}

describe('talking turn (hands-free loop)', () => {
  it('runs tap -> VAD confirm -> capture -> grace auto-send -> spoken reply -> re-armed listening', async () => {
    const h = makeHarness('talking');
    await talkThrough(h, 'Qual é o prazo do processo?');
    expect(h.marks).toEqual(
      expect.arrayContaining(['audio_in', 'first_interim', 'utterance_end']),
    );

    // The finished-sounding sentence got the SHORT grace window (eot=1 -> minMs).
    expect(h.timers.msList()).toContain(1_500);
    h.timers.fire((ms) => ms === 1_500);
    expect(h.sent).toEqual([{ text: 'Qual é o prazo do processo?', mode: 'talking' }]);
    expect(h.driver.getState().status).toBe('sending');
    expect(h.stt.closes).toBe(0); // talking keeps the stream open (standby, not teardown)

    // turn_committed rides the open stream once the UI knows the message id.
    h.driver.commitTurn('msg-42');
    expect(h.stt.committed).toEqual([{ id: 'msg-42', mode: 'talking' }]);

    // Reply streams: chunks become speech-channel sentences; first audio -> speaking.
    h.driver.notifyReplyStarted();
    expect(h.driver.getState().status).toBe('awaiting');
    expect(h.marks).toContain('agent_first_token');
    h.driver.notifyReplyChunk('O prazo é de 30 dias.');
    expect(h.speech.texts).toEqual(['O prazo é de 30 dias.']);
    h.driver.handleSpeechAudible();
    expect(h.driver.getState().status).toBe('speaking');
    expect(h.marks).toContain('tts_first_audio');

    // Run settles -> flush the tail; the speech queue drains -> agentDone -> listening.
    h.driver.notifyRunSettled();
    expect(h.speech.flushes).toBe(1);
    h.speech.idleState = true;
    h.driver.handleSpeechIdle();
    expect(h.driver.getState().status).toBe('listening');
  });

  it('mid-thought pause gets the LONG grace window and resumed speech cancels it', async () => {
    const h = makeHarness('talking');
    h.driver.tapMic();
    await h.settle();
    h.vad.speaking = true;
    h.driver.handleVadSpeechStart();
    h.timers.fire((ms) => ms === 300);
    srv(h, final('E além disso o contrato de'));
    srv(h, { type: 'utterance_end', transcript: 'E além disso o contrato de' });
    // Dangling connective -> eot 0 -> maxMs.
    expect(h.timers.msList()).toContain(6_000);
    // The user resumes: new interim cancels the pending send.
    srv(h, interim('arrendamento'));
    expect(h.timers.msList()).not.toContain(6_000);
    expect(h.sent).toHaveLength(0);
  });

  it('short VAD burst never opens capture (candidate cancelled)', async () => {
    const h = makeHarness('talking');
    h.driver.tapMic();
    await h.settle();
    h.vad.speaking = true;
    h.driver.handleVadSpeechStart();
    h.vad.speaking = false;
    h.driver.handleVadSpeechEnd(); // burst ended before the gate
    expect(h.driver.getState().status).toBe('listening');
    expect(h.timers.msList()).not.toContain(300); // confirmation timer cancelled
  });

  it('the send-now escape hatch fires without waiting for the grace timer', async () => {
    const h = makeHarness('talking');
    await talkThrough(h, 'Envia já esta pergunta?');
    expect(h.sent).toHaveLength(0);
    h.driver.sendNow(); // on-screen tap - never make the user wait for a timer
    expect(h.sent).toEqual([{ text: 'Envia já esta pergunta?', mode: 'talking' }]);
  });

  it('second tap anywhere in the loop exits it (teardown to idle)', async () => {
    const h = makeHarness('talking');
    h.driver.tapMic();
    await h.settle();
    h.driver.tapMic();
    expect(h.driver.getState().status).toBe('idle');
    expect(h.stt.closes).toBe(1);
    expect(h.vad.destroyed).toBe(1);
    expect(h.capture.stopped).toBeGreaterThan(0);
  });
});

/* --------------------------------------- barge-in --------------------------------------- */

describe('barge-in during TTS', () => {
  it('confirmed speech while speaking clears the TTS and opens a fresh capture', async () => {
    const h = makeHarness('talking');
    await talkThrough(h, 'Primeira pergunta.');
    h.timers.fire((ms) => ms === 1_500);
    h.driver.notifyReplyStarted();
    h.driver.notifyReplyChunk('Resposta longa. ');
    h.driver.handleSpeechAudible();
    expect(h.driver.getState().status).toBe('speaking');

    // The user talks over the reply: candidate -> sustained -> confirmed.
    h.vad.speaking = true;
    h.driver.handleVadSpeechStart();
    expect(h.driver.getState().status).toBe('confirming');
    h.timers.fire((ms) => ms === 300);
    expect(h.driver.getState().status).toBe('capturing');
    expect(h.speech.clears).toBeGreaterThan(0); // clearTts executed
    expect(h.marks).toContain('barge_in');
  });

  it('a short burst during TTS does NOT clip the reply', async () => {
    const h = makeHarness('talking');
    await talkThrough(h, 'Pergunta.');
    h.timers.fire((ms) => ms === 1_500);
    h.driver.notifyReplyStarted();
    h.driver.handleSpeechAudible();
    const clearsBefore = h.speech.clears;

    h.vad.speaking = true;
    h.driver.handleVadSpeechStart();
    h.vad.speaking = false;
    h.driver.handleVadSpeechEnd(); // cancelled before the gate
    expect(h.driver.getState().status).toBe('speaking');
    expect(h.speech.clears).toBe(clearsBefore); // playback untouched
  });
});

/* ---------------------------------- standby + pending note ---------------------------------- */

describe('standby + pending note through a long agent task', () => {
  it('quiet sending goes to standby; confirmed speech captures a pending note and re-arms', async () => {
    const h = makeHarness('talking');
    await talkThrough(h, 'Analisa este contrato.');
    h.timers.fire((ms) => ms === 1_500);
    expect(h.driver.getState().status).toBe('sending');

    // No reply activity for busyAfterMs: the machine parks in standby, mic dormant.
    h.timers.fire((ms) => ms === 2_500);
    expect(h.driver.getState().status).toBe('standby');
    h.driver.handleFrame(new ArrayBuffer(4));
    expect(h.stt.audioFrames).toHaveLength(0); // dormant: no frames forwarded

    // The user interjects mid-task: confirmed speech becomes a pending-note capture.
    h.vad.speaking = true;
    h.driver.handleVadSpeechStart();
    h.timers.fire((ms) => ms === 300);
    expect(h.driver.getState().status).toBe('capturing');
    expect(h.driver.getState().noteCapture).toBe(true);
    h.driver.handleFrame(new ArrayBuffer(4));
    expect(h.stt.audioFrames).toHaveLength(1); // mic woken for the note

    srv(h, final('e verifica também o prazo de recurso'));
    h.vad.speaking = false;
    h.driver.handleVadSpeechEnd();
    srv(h, { type: 'utterance_end', transcript: 'e verifica também o prazo de recurso' });
    // The note lands on the RUNNING turn (never a new send) and the mic goes dormant again.
    expect(h.notes).toEqual(['e verifica também o prazo de recurso']);
    expect(h.sent).toHaveLength(1); // still only the original turn
    expect(h.driver.getState().status).toBe('standby');

    // The long task finishes: drain -> re-armed listening.
    h.driver.notifyRunSettled();
    h.driver.handleSpeechIdle();
    expect(h.driver.getState().status).toBe('listening');
  });
});

/* ----------------------- rapid toggle during the async open path ----------------------- */

/** Capture chain whose start() promises are DEFERRED - settled explicitly by the test, so
 *  a stop can land while the "permission prompt" hangs. FIFO, like real getUserMedia. */
class DeferredCapture implements CaptureChainLike {
  started = 0;
  stopped = 0;
  private waiters: Array<{ res: () => void; rej: (e: Error) => void }> = [];
  start(): Promise<void> {
    this.started += 1;
    return new Promise((res, rej) => this.waiters.push({ res, rej }));
  }
  resolveStart(): void {
    this.waiters.shift()?.res();
  }
  rejectStart(): void {
    this.waiters.shift()?.rej(new Error('denied'));
  }
  stop(): void {
    this.stopped += 1;
  }
  get context(): AudioContext | null {
    return null;
  }
  get stream(): MediaStream | null {
    return null;
  }
}

/** STT channel whose open() dials are DEFERRED (a close during the dial rejects it, like
 *  the real socket's onclose). */
class DeferredStt implements SttChannelLike {
  opens = 0;
  closes = 0;
  closeStreams = 0;
  private open_ = false;
  private waiters: Array<{ res: () => void; rej: (e: Error) => void }> = [];
  open(): Promise<void> {
    this.opens += 1;
    return new Promise((res, rej) => this.waiters.push({ res, rej }));
  }
  resolveOpen(): void {
    const w = this.waiters.shift();
    if (w) {
      this.open_ = true;
      w.res();
    }
  }
  rejectOpen(): void {
    this.waiters.shift()?.rej(new Error('socket closed'));
  }
  sendAudio(): void {}
  sendCloseStream(): void {
    this.closeStreams += 1;
  }
  sendTurnCommitted(): void {}
  close(): void {
    this.closes += 1;
    this.open_ = false;
  }
  get isOpen(): boolean {
    return this.open_;
  }
}

interface DeferredHarness {
  driver: VoiceSessionDriver;
  capture: DeferredCapture;
  stt: DeferredStt;
  errors: string[];
  vadControl: { resolve?: (vad: VadLike) => void; reject?: (e: Error) => void };
  settle: () => Promise<void>;
}

function makeDeferredHarness(mode: VoiceMode): DeferredHarness {
  const capture = new DeferredCapture();
  const stt = new DeferredStt();
  const errors: string[] = [];
  const vadControl: DeferredHarness['vadControl'] = {};
  const driver = new VoiceSessionDriver(mode, {
    capture,
    stt,
    speech: new FakeSpeech(),
    startVad:
      mode === 'talking'
        ? () =>
            new Promise<VadLike>((res, rej) => {
              vadControl.resolve = res;
              vadControl.reject = rej;
            })
        : undefined,
    timers: new FakeTimers(),
    hooks: {
      onStateChange: () => undefined,
      onLevel: () => undefined,
      onSendTranscript: () => undefined,
      onPendingNote: () => undefined,
      onError: (code) => errors.push(code),
    },
  });
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { driver, capture, stt, errors, vadControl, settle };
}

describe('rapid toggle during the open path (deliberate cancel is never an error)', () => {
  it('stop while the mic permission hangs: teardown ran, no dial, no error', async () => {
    const h = makeDeferredHarness('manual');
    h.driver.tapMic(); // open path starts; capture.start() pending
    expect(h.capture.started).toBe(1);
    h.driver.tapMic(); // deliberate stop while the prompt hangs
    expect(h.driver.getState().status).toBe('idle');
    expect(h.capture.stopped).toBeGreaterThan(0); // teardown released the session

    h.capture.resolveStart(); // the mic finally opens - a newer toggle already won
    await h.settle();
    expect(h.stt.opens).toBe(0); // the dead session never dials
    expect(h.errors).toEqual([]); // no MIC_DENIED/CAPTURE_FAILED for a cancel
    expect(h.driver.getState().status).toBe('idle');
  });

  it('a mic denial arriving AFTER the deliberate stop stays silent', async () => {
    const h = makeDeferredHarness('manual');
    h.driver.tapMic();
    h.driver.tapMic(); // stop first
    h.capture.rejectStart(); // then the prompt resolves as denied
    await h.settle();
    expect(h.errors).toEqual([]); // the session was cancelled - denial is moot
    expect(h.driver.getState().status).toBe('idle');
  });

  it('stop while the STT dial hangs: socket closed by teardown, no CAPTURE_FAILED', async () => {
    const h = makeDeferredHarness('manual');
    h.driver.tapMic();
    h.capture.resolveStart();
    await h.settle();
    expect(h.stt.opens).toBe(1); // dialing

    h.driver.tapMic(); // stop mid-dial
    expect(h.driver.getState().status).toBe('idle');
    expect(h.stt.closes).toBe(1); // teardown closed the pending socket
    expect(h.capture.stopped).toBeGreaterThan(0);

    h.stt.rejectOpen(); // the closed socket rejects the dial (real onclose behavior)
    await h.settle();
    expect(h.errors).toEqual([]); // a cancel, never CAPTURE_FAILED
  });

  it('an STT dial that RESOLVES after the stop is ignored (no error, still idle)', async () => {
    const h = makeDeferredHarness('manual');
    h.driver.tapMic();
    h.capture.resolveStart();
    await h.settle();
    h.driver.tapMic(); // stop between the dial and its resolution
    h.stt.resolveOpen();
    await h.settle();
    expect(h.errors).toEqual([]);
    expect(h.driver.getState().status).toBe('idle');
  });

  it('talking: stop while the VAD loads destroys the fresh VAD silently', async () => {
    const h = makeDeferredHarness('talking');
    h.driver.tapMic();
    h.capture.resolveStart();
    await h.settle();
    h.stt.resolveOpen();
    await h.settle();
    expect(h.driver.getState().status).toBe('listening'); // VAD wasm still loading

    h.driver.tapMic(); // exit the loop while the load hangs
    expect(h.driver.getState().status).toBe('idle');

    const vad = new FakeVad();
    h.vadControl.resolve?.(vad); // the load completes - for a dead session
    await h.settle();
    expect(vad.destroyed).toBe(1); // never published, so the open path destroys it
    expect(h.errors).toEqual([]); // and stays silent (no VAD_LOAD_FAILED)
  });

  it('talking: a VAD load FAILURE after the stop stays silent too', async () => {
    const h = makeDeferredHarness('talking');
    h.driver.tapMic();
    h.capture.resolveStart();
    await h.settle();
    h.stt.resolveOpen();
    await h.settle();
    h.driver.tapMic(); // stop while the wasm loads
    h.vadControl.reject?.(new Error('wasm load failed'));
    await h.settle();
    expect(h.errors).toEqual([]);
    expect(h.driver.getState().status).toBe('idle');
  });

  it('stop -> immediate restart: the stale open never clobbers the new session', async () => {
    const h = makeDeferredHarness('manual');
    h.driver.tapMic(); // open #1 pending
    h.driver.tapMic(); // stop
    h.driver.tapMic(); // open #2 pending (a fresh session)
    expect(h.capture.started).toBe(2);

    h.capture.resolveStart(); // #1 resolves - stale generation
    await h.settle();
    expect(h.stt.opens).toBe(0); // the stale open must NOT dial

    h.capture.resolveStart(); // #2 resolves - the live session proceeds
    await h.settle();
    expect(h.stt.opens).toBe(1);
    h.stt.resolveOpen();
    await h.settle();
    expect(h.errors).toEqual([]);
    expect(h.driver.getState().status).toBe('capturing');
  });
});

/* ----------------------------- inactivity + disconnect honesty ----------------------------- */

describe('lifecycle honesty', () => {
  it('shuts down after the inactivity tick limit', async () => {
    const h = makeHarness('talking');
    h.driver.tapMic();
    await h.settle();
    for (let i = 0; i < 10; i++) h.timers.fire((ms) => ms === 60_000);
    expect(h.driver.getState().status).toBe('idle');
    expect(h.stt.closes).toBe(1);
  });

  it('an unexpected socket drop surfaces an error and tears down', async () => {
    const h = makeHarness('talking');
    h.driver.tapMic();
    await h.settle();
    h.driver.handleSttClose({ expected: false });
    expect(h.errors).toContain('VOICE_DISCONNECTED');
    expect(h.driver.getState().status).toBe('idle');
  });

  it('a provider error message tears down honestly', async () => {
    const h = makeHarness('manual');
    h.driver.tapMic();
    await h.settle();
    srv(h, { type: 'error', code: 'VOICE_PROVIDER_ERROR', message: 'x' });
    expect(h.errors).toContain('VOICE_PROVIDER_ERROR');
    expect(h.driver.getState().status).toBe('idle');
  });
});
