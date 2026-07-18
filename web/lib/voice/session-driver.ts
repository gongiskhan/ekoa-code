/**
 * Voice session driver (mega-run C4). OWNS one C3 reducer instance and EXECUTES its effect
 * descriptors host-side - the imperative half the reducer refuses to contain:
 *
 *   openSttStream/sendAudio/closeStt -> the capture chain + STT WebSocket;
 *   say/clearTts                     -> the speech channel (C5 playback + tts socket);
 *   scheduleGraceWindow/startConfirmationTimer/armStandby -> injected timers;
 *   appendPendingNote/emitLatencyMark -> host callbacks.
 *
 * WS transcript/utterance_end events feed BACK as reducer events (with the client-side
 * finals accumulation the reducer's transcript model expects), VAD start/end feeds the
 * speechCandidate/confirmation path, and the UI feeds reply progress (notifyReply*).
 *
 * EVERY collaborator is injected (capture, sockets, speech, vad, timers), so a test
 * drives a full manual and talking turn with fakes - no mic, no network, no Web Audio.
 * The React glue (real deps + store wiring) lives in components/voice/use-voice-session.
 */
import type { VoiceSttServerMessage } from '@ekoa/shared';
import {
  DEFAULT_VOICE_CONFIG,
  initialState,
  reduce,
  type LatencyMark,
  type VoiceConfig,
  type VoiceEffect,
  type VoiceEvent,
  type VoiceMode,
  type VoiceState,
} from './voice-machine';
import { eotFromInterim } from './grace-window';

export type VoiceErrorCode =
  | 'MIC_DENIED'
  | 'CAPTURE_FAILED'
  | 'VAD_LOAD_FAILED'
  | 'VOICE_PROVIDER_ERROR'
  | 'VOICE_DISCONNECTED'
  | 'VOICE_TTS_FAILED';

/* ------------------------- injected collaborator surfaces ------------------------- */

export interface CaptureChainLike {
  start(): Promise<void>;
  stop(): void;
  readonly context: AudioContext | null;
  readonly stream: MediaStream | null;
}

export interface SttChannelLike {
  open(): Promise<void>;
  sendAudio(frame: ArrayBuffer): void;
  sendCloseStream(): void;
  sendTurnCommitted(transcriptMessageId: string, mode: VoiceMode): void;
  close(): void;
  readonly isOpen: boolean;
}

export interface SpeechLike {
  unlock(): void;
  enqueueText(text: string): void;
  flushText(): void;
  clear(): void;
  readonly idle: boolean;
}

export interface VadLike {
  readonly speaking: boolean;
  destroy(): void;
}

export interface TimerApi {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface VoiceDriverHooks {
  onStateChange(state: VoiceState): void;
  onLevel(level: number): void;
  /** A finished utterance must become a chat message NOW (auto-send in talking mode; the
   *  explicit send in manual). The UI sends it and MAY call commitTurn with the id. */
  onSendTranscript(text: string, mode: VoiceMode): void;
  /** Confirmed speech while the agent works: a pending note for the running turn, never a
   *  new auto-send. NOTE (v1, documented deviation - run memo c-voice-deviations.md §v):
   *  agent runs are not mid-run injectable, so the host QUEUES the note
   *  (queue-while-building) and it becomes the next turn once the run settles. */
  onPendingNote(text: string): void;
  onError(code: VoiceErrorCode): void;
  onLatencyMark?(mark: LatencyMark, atMs: number): void;
}

export interface VoiceDriverDeps {
  capture: CaptureChainLike;
  stt: SttChannelLike;
  speech: SpeechLike;
  /** Talking mode only: start the VAD over the open capture graph. Absent in manual. */
  startVad?: (ctx: AudioContext | null, stream: MediaStream | null) => Promise<VadLike>;
  timers?: TimerApi;
  now?: () => number;
  hooks: VoiceDriverHooks;
  config?: Partial<VoiceConfig> & {
    /** Quiet time in sending/awaiting before the machine goes to standby (agentBusy). */
    busyAfterMs?: number;
    /** Interval feeding the reducer's inactivityTick counter. */
    inactivityTickMs?: number;
  };
}

const defaultTimers: TimerApi = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const DEFAULT_BUSY_AFTER_MS = 2_500;
const DEFAULT_INACTIVITY_TICK_MS = 60_000;

export class VoiceSessionDriver {
  private state: VoiceState;
  private readonly timers: TimerApi;
  private readonly now: () => number;
  private vad: VadLike | null = null;
  private forwarding = false;
  private disposed = false;
  /** Client-side finals accumulation (reset per capture / per utterance_end). */
  private finals = '';
  private lastUtteranceText = '';
  private graceHandle: unknown = null;
  private confirmHandle: unknown = null;
  private busyHandle: unknown = null;
  private tickHandle: unknown = null;
  private runSettled = true;
  /** Reentrancy guard: dispatches from effect execution queue up, never interleave. */
  private queue: VoiceEvent[] = [];
  private draining = false;
  private startedAt: number;
  /** Monotonic session generation, bumped on every teardown to idle. An async open path
   *  captures it at open-start and re-checks after EVERY await: a mismatch means the
   *  session was stopped or superseded by a newer toggle mid-open, so the open path
   *  tears down anything it created that teardown could not see and returns SILENTLY -
   *  a deliberate cancel never raises MIC_DENIED/CAPTURE_FAILED.
   *  Bounded by reality: this increments once per open; Number.MAX_SAFE_INTEGER (~9e15)
   *  toggles is physically unreachable in a session, so integer aliasing cannot occur. */
  private sessionGeneration = 0;

  constructor(
    public readonly mode: VoiceMode,
    private readonly deps: VoiceDriverDeps,
  ) {
    this.timers = deps.timers ?? defaultTimers;
    this.now = deps.now ?? (() => Date.now());
    this.startedAt = this.now();
    this.state = initialState(mode, {
      ...DEFAULT_VOICE_CONFIG,
      ...deps.config,
    });
  }

  getState(): VoiceState {
    return this.state;
  }

  /* --------------------------------- UI entry points --------------------------------- */

  /** MUST be called from a user tap handler: unlock runs synchronously before any await. */
  tapMic(): void {
    this.deps.speech.unlock();
    this.startedAt = this.now();
    this.dispatch({ type: 'tapMic' });
  }

  /** The on-screen "send now" escape hatch (and the manual explicit send). */
  sendNow(): void {
    this.dispatch({ type: 'sendNow' });
  }

  /** Full teardown to idle (backgrounding, unmount, mode switch). */
  close(): void {
    this.dispatch({ type: 'close' });
  }

  dispose(): void {
    this.close();
    this.disposed = true;
    this.clearAllTimers();
  }

  /** Manual tap-stop leaves the captured transcript in state for the composer; the UI
   *  takes it exactly once through here. */
  takeTranscript(): string {
    const text = this.state.transcript.trim();
    if (text) {
      this.state = { ...this.state, transcript: '', interim: '' };
      this.deps.hooks.onStateChange(this.state);
    }
    return text;
  }

  /** Best-effort turn_committed (refs only). Talking mode keeps the stream open; a manual
   *  turn's socket is already closed and the relay flushes ref-less by design. */
  commitTurn(transcriptMessageId: string): void {
    if (this.deps.stt.isOpen) {
      this.deps.stt.sendTurnCommitted(transcriptMessageId, this.mode);
    }
  }

  /* ------------------------------ reply-progress inputs ------------------------------ */

  notifyReplyStarted(): void {
    this.runSettled = false;
    this.dispatch({ type: 'replyStarted' });
  }

  notifyReplyChunk(text: string): void {
    if (this.state.status === 'standby') {
      // A chunk while dormant means the reply began: wake to awaiting first (the reducer
      // accepts replyStarted from standby), then stream the chunk.
      this.dispatch({ type: 'replyStarted' });
    }
    this.armBusyTimer(); // reply activity defers standby
    this.dispatch({ type: 'replyTextChunk', text });
  }

  /** The run settled (isExecuting flipped false): flush the sentence tail, then dispatch
   *  agentDone only when the speech queue fully drains (drain-then-re-arm). */
  notifyRunSettled(): void {
    this.runSettled = true;
    this.cancelBusyTimer();
    this.deps.speech.flushText();
    this.maybeAgentDone();
  }

  /* --------------------------------- collaborator wiring --------------------------------- */

  /** Wire as the capture chain's frame hook. */
  handleFrame(frame: ArrayBuffer): void {
    if (this.forwarding && this.deps.stt.isOpen) this.deps.stt.sendAudio(frame);
  }

  handleLevel(level: number): void {
    this.deps.hooks.onLevel(level);
  }

  /** Wire as the STT socket's message hook. */
  handleSttMessage(msg: VoiceSttServerMessage): void {
    switch (msg.type) {
      case 'transcript': {
        // Client-side finals accumulation: interims render joined onto the finals so far;
        // a final folds into the accumulator (the reducer's transcript model, C3).
        const text = joinText(this.finals, msg.text);
        if (msg.isFinal) this.finals = text;
        this.lastUtteranceText = text;
        this.dispatch({ type: 'interim', text });
        return;
      }
      case 'utterance_end': {
        const eot = eotFromInterim(this.lastUtteranceText || msg.transcript);
        this.finals = '';
        this.lastUtteranceText = '';
        this.dispatch({ type: 'utteranceEnd', eot });
        return;
      }
      case 'error':
        this.deps.hooks.onError('VOICE_PROVIDER_ERROR');
        this.dispatch({ type: 'close' });
        return;
      default:
        return; // ready / speech_started need no reducer event (VAD drives candidates)
    }
  }

  /** Wire as the STT socket's close hook. */
  handleSttClose(info: { expected: boolean }): void {
    if (info.expected || this.disposed) return;
    if (this.state.status !== 'idle') {
      this.deps.hooks.onError('VOICE_DISCONNECTED');
      this.dispatch({ type: 'close' });
    }
  }

  /** Wire as the speech channel's onAudible hook. */
  handleSpeechAudible(): void {
    this.armBusyTimer();
    this.dispatch({ type: 'ttsFirstAudio' });
  }

  /** Wire as the speech channel's onIdle hook. */
  handleSpeechIdle(): void {
    this.maybeAgentDone();
  }

  /* ------------------------------------ VAD wiring ------------------------------------ */

  handleVadSpeechStart(): void {
    this.dispatch({ type: 'speechCandidate' });
  }

  handleVadSpeechEnd(): void {
    if (this.state.status === 'confirming') this.dispatch({ type: 'speechCancelled' });
  }

  handleVadMisfire(): void {
    if (this.state.status === 'confirming') this.dispatch({ type: 'speechCancelled' });
  }

  /* ------------------------------------- dispatch ------------------------------------- */

  dispatch(event: VoiceEvent): void {
    if (this.disposed) return;
    this.queue.push(event);
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        const prev = this.state;
        const { state, effects } = reduce(prev, next);
        this.state = state;
        this.afterTransition(prev, state);
        this.runEffects(effects);
        if (state !== prev) this.deps.hooks.onStateChange(state);
      }
    } finally {
      this.draining = false;
    }
  }

  private afterTransition(prev: VoiceState, next: VoiceState): void {
    // A resolved (or abandoned) candidate leaves no armed confirmation timer behind.
    if (prev.status === 'confirming' && next.status !== 'confirming') this.cancelConfirm();
    // A fresh capture opened: reset the client-side finals accumulation.
    if (next.status === 'capturing' && prev.status !== 'capturing') {
      this.finals = '';
      this.lastUtteranceText = '';
    }
    // A turn left for the agent: hand the transcript to the UI (auto-send in talking;
    // the explicit send in manual). Pending notes go through appendPendingNote instead.
    if (next.status === 'sending' && prev.status !== 'sending' && next.transcript.trim()) {
      this.runSettled = false;
      this.armBusyTimer();
      this.deps.hooks.onSendTranscript(next.transcript.trim(), this.mode);
    }
    // Ticker runs while the session is alive; idle stops it.
    if (next.status !== 'idle' && this.tickHandle === null) this.armTicker();
    if (next.status === 'idle' && prev.status !== 'idle') this.teardownSession();
  }

  private runEffects(effects: VoiceEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'openSttStream':
          void this.openSttStream();
          break;
        case 'sendAudio':
          this.forwarding = true;
          break;
        case 'armStandby':
          this.forwarding = false;
          break;
        case 'closeStt':
          this.deps.stt.sendCloseStream();
          this.deps.stt.close();
          this.forwarding = false;
          break;
        case 'say':
          this.deps.speech.enqueueText(effect.text);
          break;
        case 'clearTts':
          this.deps.speech.clear();
          break;
        case 'scheduleGraceWindow':
          this.cancelGrace();
          this.graceHandle = this.timers.set(() => {
            this.graceHandle = null;
            this.dispatch({ type: 'sendNow' });
          }, effect.ms);
          break;
        case 'cancelGraceWindow':
          this.cancelGrace();
          break;
        case 'startConfirmationTimer':
          this.cancelConfirm();
          this.confirmHandle = this.timers.set(() => {
            this.confirmHandle = null;
            const speaking = this.vad?.speaking ?? false;
            this.dispatch({ type: speaking ? 'speechConfirmed' : 'speechCancelled' });
          }, effect.ms);
          break;
        case 'appendPendingNote':
          this.deps.hooks.onPendingNote(effect.text);
          break;
        case 'emitLatencyMark':
          this.deps.hooks.onLatencyMark?.(effect.mark, this.now() - this.startedAt);
          break;
      }
    }
  }

  /* ------------------------------------ internals ------------------------------------ */

  /** True when the open path captured at `gen` lost to a stop/newer toggle mid-await. */
  private openCancelled(gen: number): boolean {
    return this.disposed || gen !== this.sessionGeneration;
  }

  private async openSttStream(): Promise<void> {
    const gen = this.sessionGeneration;
    try {
      await this.deps.capture.start();
    } catch {
      // A deliberate stop during the permission prompt is a cancel, not a denial.
      if (this.openCancelled(gen)) return;
      this.deps.hooks.onError('MIC_DENIED');
      this.dispatch({ type: 'close' });
      return;
    }
    // Stopped while the mic opened: teardown already ran (capture.stop() there bumped the
    // capture generation, so the pending start released its own tracks/context). Nothing
    // to surface - the cancel was deliberate.
    if (this.openCancelled(gen)) return;
    try {
      await this.deps.stt.open();
    } catch {
      // Teardown's stt.close() rejects a pending dial - again a cancel, not a failure.
      if (this.openCancelled(gen)) return;
      this.deps.capture.stop();
      this.deps.hooks.onError('CAPTURE_FAILED');
      this.dispatch({ type: 'close' });
      return;
    }
    // Stopped between the dial resolving and this microtask: teardown already closed the
    // published socket + capture; just bow out (never touch a newer generation's socket).
    if (this.openCancelled(gen)) return;
    if (this.mode === 'talking' && this.deps.startVad) {
      let vad: VadLike;
      try {
        vad = await this.deps.startVad(this.deps.capture.context, this.deps.capture.stream);
      } catch {
        if (this.openCancelled(gen)) return; // stopped while the VAD loaded: silent
        // Talking mode NEEDS the VAD (hands-free loop + barge-in). Fail honestly.
        this.deps.hooks.onError('VAD_LOAD_FAILED');
        this.dispatch({ type: 'close' });
        return;
      }
      if (this.openCancelled(gen)) {
        // Teardown ran while the VAD loaded and could not see it (never published):
        // destroy the fresh instance here, silently.
        vad.destroy();
        return;
      }
      this.vad = vad;
    }
  }

  private maybeAgentDone(): void {
    if (this.runSettled && this.deps.speech.idle) {
      this.dispatch({ type: 'agentDone' });
    }
  }

  private armBusyTimer(): void {
    this.cancelBusyTimer();
    this.busyHandle = this.timers.set(() => {
      this.busyHandle = null;
      this.dispatch({ type: 'agentBusy' });
    }, this.deps.config?.busyAfterMs ?? DEFAULT_BUSY_AFTER_MS);
  }

  private cancelBusyTimer(): void {
    if (this.busyHandle !== null) {
      this.timers.clear(this.busyHandle);
      this.busyHandle = null;
    }
  }

  private armTicker(): void {
    this.tickHandle = this.timers.set(() => {
      this.tickHandle = null;
      // afterTransition re-arms while the session stays alive (tickHandle is null here).
      this.dispatch({ type: 'inactivityTick' });
    }, this.deps.config?.inactivityTickMs ?? DEFAULT_INACTIVITY_TICK_MS);
  }

  private cancelGrace(): void {
    if (this.graceHandle !== null) {
      this.timers.clear(this.graceHandle);
      this.graceHandle = null;
    }
  }

  private cancelConfirm(): void {
    if (this.confirmHandle !== null) {
      this.timers.clear(this.confirmHandle);
      this.confirmHandle = null;
    }
  }

  private clearAllTimers(): void {
    this.cancelGrace();
    this.cancelConfirm();
    this.cancelBusyTimer();
    if (this.tickHandle !== null) {
      this.timers.clear(this.tickHandle);
      this.tickHandle = null;
    }
  }

  /** Idle teardown: stop the mic + VAD, silence speech, drop timers (socket close already
   *  rode the closeStt effect). */
  private teardownSession(): void {
    this.sessionGeneration += 1; // cancels any in-flight open path (rapid-toggle guard)
    this.clearAllTimers();
    this.vad?.destroy();
    this.vad = null;
    this.deps.capture.stop();
    this.deps.speech.clear();
    this.forwarding = false;
    this.finals = '';
    this.lastUtteranceText = '';
    this.runSettled = true;
  }
}

function joinText(a: string, b: string): string {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}
