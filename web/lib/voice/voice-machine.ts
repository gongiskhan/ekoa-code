/**
 * Pure voice state machine (BRIEF §5, run 20260717-190134, slice C3). New write per
 * memos/c-voice-deviations.md (i): the BRIEF's named jarvis artifacts do not exist; this module
 * is seeded behaviorally by garrison's legacy-voice.tsx inline machine (state union +
 * transition table) and jarvis-os pauseVad/endTurnIfDone (drain-then-re-arm = the standby
 * seed), both read-only references.
 *
 * Contract: reduce(state, event) -> { state, effects } with ZERO side effects. No React, no
 * DOM, no timers, no sockets - every imperative thing the host must do (open/close the STT
 * stream, run the confirmation/grace timers, speak, clear TTS, arm standby, append a pending
 * note, mark latency) is returned as an Effect descriptor. The host executes effects and
 * feeds outcomes back in as events; timers in particular live host-side (startConfirmationTimer
 * -> speechConfirmed/speechCancelled; scheduleGraceWindow -> sendNow when it fires).
 *
 * Two modes (BRIEF §5 table):
 * - manual: tap mic starts/stops capture; send is explicit (sendNow); nothing is read aloud
 *   by the machine (the "ouvir" action is a host concern outside this reducer).
 * - talking: one tap arms a hands-free loop (listening -> confirming -> capturing -> sending
 *   -> awaiting -> speaking -> listening); silence endpointing auto-sends via the adaptive
 *   grace window; replies stream to TTS (say effects); barge-in is supported.
 *
 * Standby (BRIEF §5 mobile checklist): while the agent works (agentBusy) the mic + VAD stay
 * conceptually alive but dormant (armStandby); confirmed speech during processing is captured
 * as a pending note appended to the running turn (appendPendingNote), never a new turn.
 * agentDone is the drain-then-re-arm point: the host dispatches it only when the reply stream
 * AND the speech queue have fully drained (the jarvis endTurnIfDone rule), and the machine
 * re-arms to listening (talking) or returns to idle (manual).
 */

import { DEFAULT_GRACE_BOUNDS, graceWindowMs, type GraceWindowBounds } from './grace-window';

export type VoiceMode = 'manual' | 'talking';

export type VoiceStatus =
  | 'idle'
  | 'listening'
  | 'confirming'
  | 'capturing'
  | 'sending'
  | 'awaiting'
  | 'speaking'
  | 'standby';

/** Per-stage latency points (BRIEF §5 validation dashboard) plus the barge-in mark. */
export type LatencyMark =
  | 'audio_in'
  | 'first_interim'
  | 'utterance_end'
  | 'agent_first_token'
  | 'tts_first_audio'
  | 'barge_in';

/** Everything the host must DO, described - never executed - by the reducer. */
export type VoiceEffect =
  | { type: 'openSttStream' }
  | { type: 'sendAudio' }
  | { type: 'closeStt' }
  | { type: 'say'; text: string }
  | { type: 'clearTts' }
  | { type: 'scheduleGraceWindow'; ms: number }
  | { type: 'cancelGraceWindow' }
  | { type: 'startConfirmationTimer'; ms: number }
  | { type: 'armStandby' }
  | { type: 'appendPendingNote'; text: string }
  | { type: 'emitLatencyMark'; mark: LatencyMark };

export type VoiceEvent =
  | { type: 'tapMic' }
  | { type: 'speechCandidate' }
  | { type: 'speechConfirmed' }
  | { type: 'speechCancelled' }
  | { type: 'interim'; text: string }
  | { type: 'utteranceEnd'; eot: number | null }
  | { type: 'sendNow' }
  | { type: 'replyStarted' }
  | { type: 'replyTextChunk'; text: string }
  | { type: 'ttsFirstAudio' }
  | { type: 'bargeInDetected' }
  | { type: 'agentBusy' }
  | { type: 'agentDone' }
  | { type: 'pendingNote'; text: string }
  | { type: 'inactivityTick' }
  | { type: 'close' };

export interface VoiceConfig {
  /** ~300 ms sustained-speech confirmation gate (BRIEF §5 layered noise handling, layer 3). */
  confirmMs: number;
  /** Adaptive grace window bounds (BRIEF §5 decided: 1500/6000). */
  grace: GraceWindowBounds;
  /** inactivityTicks in listening/standby before the machine closes down (10 min at 1/min). */
  inactivityTickLimit: number;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  confirmMs: 300,
  grace: DEFAULT_GRACE_BOUNDS,
  inactivityTickLimit: 10,
};

export interface VoiceState {
  mode: VoiceMode;
  status: VoiceStatus;
  /** Live interim transcript of the utterance being captured. */
  interim: string;
  /** Accumulated final transcript of the current capture (turn or pending note). */
  transcript: string;
  /** The current capture is a pending note for the running turn, not a new turn. */
  noteCapture: boolean;
  /** Status to restore if the current speech candidate cancels. */
  resumeTo: VoiceStatus | null;
  /** A grace window is armed host-side (utteranceEnd seen, sendNow pending). */
  graceArmed: boolean;
  /** The STT stream is open host-side (an openSttStream effect was emitted, no closeStt yet). */
  sttOpen: boolean;
  /** Mic frames are dormant (armStandby emitted, no sendAudio since). */
  micDormant: boolean;
  /** Once-per-turn latency marks already emitted. */
  firstInterimMarked: boolean;
  replyMarked: boolean;
  ttsMarked: boolean;
  /** Consecutive inactivityTicks while in listening/standby. */
  ticks: number;
  config: VoiceConfig;
}

export interface ReduceResult {
  state: VoiceState;
  effects: VoiceEffect[];
}

export function initialState(mode: VoiceMode, config?: Partial<VoiceConfig>): VoiceState {
  return {
    mode,
    status: 'idle',
    interim: '',
    transcript: '',
    noteCapture: false,
    resumeTo: null,
    graceArmed: false,
    sttOpen: false,
    micDormant: false,
    firstInterimMarked: false,
    replyMarked: false,
    ttsMarked: false,
    ticks: 0,
    config: { ...DEFAULT_VOICE_CONFIG, ...config, grace: { ...DEFAULT_GRACE_BOUNDS, ...config?.grace } },
  };
}

/** Join accumulated finals with a trailing interim into one utterance text. */
function joinText(a: string, b: string): string {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

/** Fields reset when a capture (turn or note) starts or the machine leaves a turn. */
const FRESH_CAPTURE = {
  interim: '',
  transcript: '',
  noteCapture: false,
  resumeTo: null,
  graceArmed: false,
  firstInterimMarked: false,
} as const;

/** Fields reset when a whole turn completes (agentDone) or the machine shuts down. */
const FRESH_TURN = {
  ...FRESH_CAPTURE,
  replyMarked: false,
  ttsMarked: false,
} as const;

const noChange = (state: VoiceState): ReduceResult => ({ state, effects: [] });

/**
 * The pure reducer. Never mutates `state`; a no-op returns the same reference so hosts can
 * cheap-compare. Any event other than inactivityTick counts as activity and resets the
 * inactivity counter.
 */
export function reduce(state: VoiceState, event: VoiceEvent): ReduceResult {
  if (event.type !== 'inactivityTick' && state.ticks !== 0) {
    state = { ...state, ticks: 0 };
  }

  switch (event.type) {
    case 'tapMic':
      return onTapMic(state);
    case 'speechCandidate':
      return onSpeechCandidate(state);
    case 'speechConfirmed':
      return state.status === 'confirming' ? confirmCandidate(state) : noChange(state);
    case 'speechCancelled':
      if (state.status !== 'confirming') return noChange(state);
      return {
        state: { ...state, status: state.resumeTo ?? fallbackStatus(state), resumeTo: null },
        effects: [],
      };
    case 'interim':
      return onInterim(state, event.text);
    case 'utteranceEnd':
      return onUtteranceEnd(state, event.eot);
    case 'sendNow':
      return onSendNow(state);
    case 'replyStarted':
      return onReplyStarted(state);
    case 'replyTextChunk':
      return onReplyTextChunk(state, event.text);
    case 'ttsFirstAudio':
      return onTtsFirstAudio(state);
    case 'bargeInDetected':
      return onBargeIn(state);
    case 'agentBusy':
      return onAgentBusy(state);
    case 'agentDone':
      return onAgentDone(state);
    case 'pendingNote':
      if (state.status !== 'standby' && state.status !== 'awaiting') return noChange(state);
      if (!event.text.trim()) return noChange(state);
      return { state, effects: [{ type: 'appendPendingNote', text: event.text.trim() }] };
    case 'inactivityTick':
      return onInactivityTick(state);
    case 'close':
      return shutdown(state);
  }
}

/** Where an aborted candidate lands when resumeTo was never set (defensive only). */
function fallbackStatus(state: VoiceState): VoiceStatus {
  return state.mode === 'talking' ? 'listening' : 'idle';
}

function onTapMic(state: VoiceState): ReduceResult {
  if (state.status === 'idle') {
    // Manual: tap starts an explicit capture. Talking: tap arms the hands-free loop
    // (listening; the VAD + confirmation gate decide when capture actually opens).
    // Ungated v1 streaming (BRIEF §5 cost decision): frames flow from stream open.
    return {
      state: {
        ...state,
        ...FRESH_TURN,
        status: state.mode === 'manual' ? 'capturing' : 'listening',
        sttOpen: true,
        micDormant: false,
      },
      effects: [
        { type: 'openSttStream' },
        { type: 'sendAudio' },
        { type: 'emitLatencyMark', mark: 'audio_in' },
      ],
    };
  }
  if (state.mode === 'manual') {
    if (state.status === 'capturing') {
      // Tap-stop: end the capture, keep the transcript for the composer; send stays explicit.
      return {
        state: {
          ...state,
          status: 'idle',
          transcript: joinText(state.transcript, state.interim),
          interim: '',
          graceArmed: false,
          sttOpen: false,
        },
        effects: [{ type: 'closeStt' }],
      };
    }
    // Manual while a turn is in flight (sending/awaiting/standby): ignore.
    return noChange(state);
  }
  // Talking: a second tap anywhere in the loop exits it.
  return shutdown(state);
}

function onSpeechCandidate(state: VoiceState): ReduceResult {
  switch (state.status) {
    case 'listening':
    case 'speaking':
    case 'standby':
    case 'awaiting':
      // Open the ~300 ms confirmation gate (generalized barge-in pattern). During speaking
      // the TTS keeps playing until the candidate is CONFIRMED - short bursts never clip it.
      return {
        state: { ...state, status: 'confirming', resumeTo: state.status },
        effects: [{ type: 'startConfirmationTimer', ms: state.config.confirmMs }],
      };
    case 'sending':
      // The utterance auto-sent but the reply has not begun; speech starting here is the user
      // continuing. Open the gate resuming as 'awaiting' so a confirmed candidate becomes a
      // pending note for the running turn (by confirm time the agent is in flight).
      return {
        state: { ...state, status: 'confirming', resumeTo: 'awaiting' },
        effects: [{ type: 'startConfirmationTimer', ms: state.config.confirmMs }],
      };
    case 'capturing': {
      // Resumed speech during an armed grace window: the user was not done - cancel it.
      if (!state.graceArmed) return noChange(state);
      return {
        state: { ...state, graceArmed: false },
        effects: [{ type: 'cancelGraceWindow' }],
      };
    }
    default:
      return noChange(state);
  }
}

/** Confirmed sustained speech: resolve the candidate by where it came from. */
function confirmCandidate(state: VoiceState): ReduceResult {
  const from = state.resumeTo ?? 'listening';
  if (from === 'speaking') {
    // Barge-in during TTS: clear playback, wake the mic (armStandby paused frames so TTS
    // could not feed back - a fresh capture must re-open audio), start a fresh turn.
    return {
      state: { ...state, ...FRESH_TURN, status: 'capturing', micDormant: false },
      effects: [{ type: 'clearTts' }, { type: 'sendAudio' }, { type: 'emitLatencyMark', mark: 'barge_in' }],
    };
  }
  if (from === 'standby' || from === 'awaiting') {
    // Speech while the agent works: capture a pending note for the RUNNING turn.
    return {
      state: { ...state, ...FRESH_CAPTURE, status: 'capturing', noteCapture: true, micDormant: false },
      effects: [{ type: 'sendAudio' }],
    };
  }
  // From listening: an ordinary turn capture opens.
  return { state: { ...state, ...FRESH_CAPTURE, status: 'capturing' }, effects: [] };
}

function onInterim(state: VoiceState, text: string): ReduceResult {
  if (state.status === 'confirming') {
    return { state: { ...state, interim: text }, effects: [] };
  }
  if (state.status !== 'capturing') return noChange(state);
  const effects: VoiceEffect[] = [];
  let next = { ...state, interim: text };
  if (!state.firstInterimMarked && text.trim()) {
    next = { ...next, firstInterimMarked: true };
    effects.push({ type: 'emitLatencyMark', mark: 'first_interim' });
  }
  if (state.graceArmed) {
    // New words after utterance_end: the pause was mid-thought - cancel the pending send.
    next = { ...next, graceArmed: false };
    effects.push({ type: 'cancelGraceWindow' });
  }
  return { state: next, effects };
}

function onUtteranceEnd(state: VoiceState, eot: number | null): ReduceResult {
  if (state.status !== 'capturing') return noChange(state);
  const transcript = joinText(state.transcript, state.interim);
  if (state.noteCapture) {
    // A pending note is a short interjection: utterance end completes it immediately
    // (no grace window) and the mic goes dormant again.
    const effects: VoiceEffect[] = [];
    if (transcript) effects.push({ type: 'appendPendingNote', text: transcript });
    effects.push({ type: 'armStandby' });
    return {
      state: { ...state, ...FRESH_CAPTURE, status: 'standby', micDormant: true },
      effects,
    };
  }
  return {
    state: { ...state, transcript, interim: '', graceArmed: true },
    effects: [
      { type: 'emitLatencyMark', mark: 'utterance_end' },
      { type: 'scheduleGraceWindow', ms: graceWindowMs(eot, state.config.grace) },
    ],
  };
}

function onSendNow(state: VoiceState): ReduceResult {
  if (state.status === 'capturing') {
    if (state.noteCapture) {
      // Explicit close of a pending-note capture behaves like its utterance end.
      return onUtteranceEnd(state, null);
    }
    const transcript = joinText(state.transcript, state.interim);
    if (!transcript) {
      // Nothing was said: an empty grace-window expiry re-arms instead of sending.
      if (state.mode === 'talking') {
        return { state: { ...state, ...FRESH_CAPTURE, status: 'listening' }, effects: [] };
      }
      return {
        state: { ...state, ...FRESH_CAPTURE, status: 'idle', sttOpen: false },
        effects: state.sttOpen ? [{ type: 'closeStt' }] : [],
      };
    }
    if (state.mode === 'talking') {
      // The turn is away; mic goes dormant NOW (jarvis pauseVad-on-send seed) so TTS and
      // agent-work noise never feed back into capture. The stream stays open for standby.
      return {
        state: {
          ...state,
          status: 'sending',
          transcript,
          interim: '',
          graceArmed: false,
          micDormant: true,
        },
        effects: [{ type: 'armStandby' }],
      };
    }
    return {
      state: {
        ...state,
        status: 'sending',
        transcript,
        interim: '',
        graceArmed: false,
        sttOpen: false,
      },
      effects: state.sttOpen ? [{ type: 'closeStt' }] : [],
    };
  }
  if (state.status === 'idle' && state.mode === 'manual' && state.transcript.trim()) {
    // Manual explicit send of a previously captured transcript.
    return { state: { ...state, status: 'sending' }, effects: [] };
  }
  return noChange(state);
}

function onReplyStarted(state: VoiceState): ReduceResult {
  if (state.status !== 'sending' && state.status !== 'standby' && state.status !== 'awaiting') {
    return noChange(state);
  }
  const effects: VoiceEffect[] = [];
  let next = { ...state, status: 'awaiting' as VoiceStatus };
  if (!state.replyMarked) {
    next = { ...next, replyMarked: true };
    effects.push({ type: 'emitLatencyMark', mark: 'agent_first_token' });
  }
  return { state: next, effects };
}

function onReplyTextChunk(state: VoiceState, text: string): ReduceResult {
  const inTurn =
    state.status === 'sending' ||
    state.status === 'awaiting' ||
    state.status === 'speaking' ||
    state.status === 'standby';
  if (!inTurn) return noChange(state);
  // Talking mode streams every reply chunk to TTS (the host's C5 pipeline sanitizes and
  // chunks into sentences). Manual mode reads aloud only on demand - never from here.
  if (state.mode !== 'talking' || !text) return noChange(state);
  return { state, effects: [{ type: 'say', text }] };
}

function onTtsFirstAudio(state: VoiceState): ReduceResult {
  const audible =
    state.status === 'awaiting' || state.status === 'sending' || state.status === 'standby';
  if (!audible) return noChange(state);
  const effects: VoiceEffect[] = [];
  let next = { ...state, status: 'speaking' as VoiceStatus };
  if (!state.ttsMarked) {
    next = { ...next, ttsMarked: true };
    effects.push({ type: 'emitLatencyMark', mark: 'tts_first_audio' });
  }
  return { state: next, effects };
}

/**
 * Host-confirmed barge-in (an already-sustained detection or an explicit interrupt tap).
 * The gated path (speechCandidate -> speechConfirmed) resolves to the same outcomes.
 */
function onBargeIn(state: VoiceState): ReduceResult {
  switch (state.status) {
    case 'speaking':
      // Wake the mic: armStandby paused frames during TTS; a fresh capture re-opens audio.
      return {
        state: { ...state, ...FRESH_TURN, status: 'capturing', micDormant: false },
        effects: [{ type: 'clearTts' }, { type: 'sendAudio' }, { type: 'emitLatencyMark', mark: 'barge_in' }],
      };
    case 'sending':
    case 'standby':
    case 'awaiting':
      // Host-confirmed speech while a turn is in flight (or auto-sent, pre-reply): a pending
      // note for the running turn, mic woken so audio streams.
      return {
        state: { ...state, ...FRESH_CAPTURE, status: 'capturing', noteCapture: true, micDormant: false },
        effects: [{ type: 'sendAudio' }],
      };
    case 'listening':
      return { state: { ...state, ...FRESH_CAPTURE, status: 'capturing' }, effects: [] };
    case 'confirming':
      return confirmCandidate(state);
    default:
      return noChange(state);
  }
}

function onAgentBusy(state: VoiceState): ReduceResult {
  const busyFrom =
    state.status === 'sending' || state.status === 'awaiting' || state.status === 'speaking';
  if (!busyFrom) return noChange(state);
  // Long-running agent work: standby. Mic + VAD stay conceptually alive but dormant
  // (armStandby); barge-in during processing captures a pending note.
  const effects: VoiceEffect[] = state.micDormant ? [] : [{ type: 'armStandby' }];
  return { state: { ...state, status: 'standby', micDormant: true }, effects };
}

function onAgentDone(state: VoiceState): ReduceResult {
  switch (state.status) {
    case 'sending':
    case 'awaiting':
    case 'speaking':
    case 'standby':
      break;
    case 'capturing':
      if (state.noteCapture) {
        // The agent finished while the user was mid-note: what they are saying is no longer
        // a note for a running turn - it becomes the start of the NEXT turn.
        return {
          state: { ...state, noteCapture: false, replyMarked: false, ttsMarked: false },
          effects: [],
        };
      }
      return noChange(state);
    case 'confirming':
      if (state.resumeTo === 'standby' || state.resumeTo === 'awaiting' || state.resumeTo === 'speaking') {
        break; // The turn the candidate belonged to is over; fall through to re-arm.
      }
      return noChange(state);
    default:
      return noChange(state);
  }
  if (state.mode === 'talking') {
    // Drain-then-re-arm (jarvis endTurnIfDone): the host dispatches agentDone only once the
    // reply and speech queues are empty, and the loop re-arms to listening.
    const effects: VoiceEffect[] = state.micDormant ? [{ type: 'sendAudio' }] : [];
    return {
      state: { ...state, ...FRESH_TURN, status: 'listening', micDormant: false },
      effects,
    };
  }
  return {
    state: { ...state, ...FRESH_TURN, status: 'idle', sttOpen: false },
    effects: state.sttOpen ? [{ type: 'closeStt' }] : [],
  };
}

function onInactivityTick(state: VoiceState): ReduceResult {
  if (state.status !== 'listening' && state.status !== 'standby') {
    return state.ticks === 0 ? noChange(state) : { state: { ...state, ticks: 0 }, effects: [] };
  }
  const ticks = state.ticks + 1;
  if (ticks >= state.config.inactivityTickLimit) {
    return shutdown(state);
  }
  return { state: { ...state, ticks }, effects: [] };
}

/** Full teardown to idle: close the stream, silence TTS if audible, drop buffers. */
function shutdown(state: VoiceState): ReduceResult {
  const effects: VoiceEffect[] = [];
  if (state.sttOpen) effects.push({ type: 'closeStt' });
  if (state.status === 'speaking') effects.push({ type: 'clearTts' });
  return {
    state: {
      ...state,
      ...FRESH_TURN,
      status: 'idle',
      sttOpen: false,
      micDormant: false,
      ticks: 0,
    },
    effects,
  };
}
