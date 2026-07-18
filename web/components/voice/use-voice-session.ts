'use client';

/**
 * useVoiceSession (mega-run C4): the React glue over the voice session driver. Assembles
 * the REAL collaborators (mic capture chain, STT/TTS sockets, C5 playback, Silero VAD)
 * around lib/voice/session-driver.ts and exposes a small surface to the composer UI.
 *
 * Division of labour: everything testable lives in lib/voice (pure parts + the driver,
 * driven by fakes in unit tests); this hook only binds browser APIs, the i18n locale, the
 * orchestration store's reply progress, and the visibility lifecycle. Field rules bound
 * here: the tap handlers run the audio unlock SYNCHRONOUSLY before any await (tapMic /
 * startTalking call into the driver in the same frame), and backgrounding tears the
 * session down honestly - screen lock kills the mic; resume is a MANUAL one-tap (decided).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveBaseUrl } from '@/lib/api/base-url';
import { getToken } from '@/lib/api/token';
import { useI18nStore } from '@/stores/i18n';
import { useOrchestrationStore } from '@/stores/orchestration';
import { captureSupport, detectCaptureEnvironment, type CaptureSupport } from '@/lib/voice/capture-support';
import { CAPTURE_TARGET_RATE, createMicCapture } from '@/lib/voice/capture';
import { createSttSocket } from '@/lib/voice/stt-socket';
import { createTtsSocket, type TtsSocket } from '@/lib/voice/tts-socket';
import { SpeechChannel } from '@/lib/voice/speech-channel';
import { startVadGate } from '@/lib/voice/vad-gate';
import { TtsPlayback, type AudioContextLike } from '@/lib/voice/tts-playback';
import { voiceLangForLocale } from '@/lib/voice/wire';
import {
  VoiceSessionDriver,
  type VoiceDriverDeps,
  type VoiceErrorCode,
} from '@/lib/voice/session-driver';
import type { VoiceMode, VoiceState, VoiceStatus } from '@/lib/voice/voice-machine';

export interface UseVoiceSessionOptions {
  sessionId: string | null;
  isExecuting: boolean;
  /** Send the finished utterance as a chat message (auto-send in talking mode; the
   *  explicit "send now" in manual). While a run executes, the caller's queue path applies. */
  onSendTranscript: (text: string) => void;
  /** Confirmed speech while the agent works. v1 (documented deviation, run memo
   *  c-voice-deviations.md §v): the caller QUEUES it (queue-while-building) and it becomes
   *  the next turn when the run settles - agent runs are not mid-run injectable. */
  onPendingNote: (text: string) => void;
  /** Manual tap-stop hands the captured transcript to the composer. */
  onManualTranscript: (text: string) => void;
}

export interface VoiceSessionApi {
  support: CaptureSupport;
  /** null = no session; otherwise the live machine mode. */
  mode: VoiceMode | null;
  status: VoiceStatus;
  interim: string;
  level: number;
  /** Backgrounding killed the mic; a manual one-tap resume is offered. */
  suspended: boolean;
  error: VoiceErrorCode | null;
  /** Tap: start manual capture / stop the manual capture / exit the talking loop. */
  tapMic: () => void;
  /** Long-press (or the explicit toggle): arm the hands-free talking loop. */
  startTalking: () => void;
  /** The on-screen escape hatch while capturing. */
  sendNow: () => void;
  dismissError: () => void;
}

const IDLE: VoiceStatus = 'idle';

export function useVoiceSession(opts: UseVoiceSessionOptions): VoiceSessionApi {
  const [support] = useState<CaptureSupport>(() =>
    typeof window === 'undefined' ? { ok: false, reason: 'no-capture-api' } : captureSupport(detectCaptureEnvironment()),
  );
  const [status, setStatus] = useState<VoiceStatus>(IDLE);
  const [mode, setMode] = useState<VoiceMode | null>(null);
  const [interim, setInterim] = useState('');
  const [level, setLevel] = useState(0);
  const [suspended, setSuspended] = useState(false);
  const [error, setError] = useState<VoiceErrorCode | null>(null);

  const driverRef = useRef<VoiceSessionDriver | null>(null);
  const speechRef = useRef<SpeechChannel | null>(null);
  /** The channel's OWN transport + playback context, closed on unmount (fix 2 - the
   *  driver only ever borrows the channel; these resources are this hook's to close,
   *  mirroring use-ouvir which closes its own). */
  const speechSocketRef = useRef<TtsSocket | null>(null);
  const speechCtxRef = useRef<AudioContextLike | null>(null);
  const streamedLenRef = useRef(0);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  /** The speech channel (tts socket + playback) survives across driver instances. */
  const ensureSpeech = useCallback((): SpeechChannel => {
    if (speechRef.current) return speechRef.current;
    const playback = new TtsPlayback({
      createContext: () => {
        const ctx = new (window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext)() as unknown as AudioContextLike;
        speechCtxRef.current = ctx; // owned here; closed by the unmount disposer
        return ctx;
      },
      onPlaybackStart: () => speechRef.current?.handlePlaybackStart(),
      onPlaybackEnd: () => speechRef.current?.handlePlaybackEnd(),
      onError: () => {
        /* malformed audio: the channel's error hook owns surfacing */
      },
    });
    const socket = createTtsSocket({
      baseUrl: resolveBaseUrl(),
      getToken,
      createWebSocket: (url) => new WebSocket(url),
      onMessage: (msg) => speechRef.current?.handleMessage(msg),
      onAudio: (frame) => speechRef.current?.handleAudio(frame),
      onDrop: () => speechRef.current?.handleSocketDrop(),
    });
    speechSocketRef.current = socket;
    speechRef.current = new SpeechChannel(
      socket,
      playback,
      () => voiceLangForLocale(useI18nStore.getState().language),
      {
        onAudible: () => driverRef.current?.handleSpeechAudible(),
        onIdle: () => driverRef.current?.handleSpeechIdle(),
        onError: () => setError('VOICE_TTS_FAILED'),
      },
    );
    return speechRef.current;
  }, []);

  const applyState = useCallback((state: VoiceState) => {
    setStatus(state.status);
    setInterim(state.interim || state.transcript);
    if (state.status === IDLE) setLevel(0);
  }, []);

  /** Create a fresh driver for one mode. Synchronous - callable inside a tap handler. */
  const createDriver = useCallback(
    (driverMode: VoiceMode): VoiceSessionDriver => {
      const token = getToken() ?? '';
      const lang = voiceLangForLocale(useI18nStore.getState().language);
      const capture = createMicCapture({
        onFrame: (frame) => driverRef.current?.handleFrame(frame),
        onLevel: (lvl) => {
          driverRef.current?.handleLevel(lvl);
        },
      });
      const stt = createSttSocket({
        baseUrl: resolveBaseUrl(),
        token,
        sampleRate: CAPTURE_TARGET_RATE,
        lang,
        createWebSocket: (url) => new WebSocket(url),
        onMessage: (msg) => driverRef.current?.handleSttMessage(msg),
        onClose: (info) => driverRef.current?.handleSttClose(info),
      });
      const deps: VoiceDriverDeps = {
        capture,
        stt,
        speech: ensureSpeech(),
        startVad:
          driverMode === 'talking'
            ? (ctx, stream) => {
                if (!ctx || !stream) return Promise.reject(new Error('no capture graph'));
                return startVadGate(ctx, stream, {
                  onSpeechStart: () => driverRef.current?.handleVadSpeechStart(),
                  onSpeechEnd: () => driverRef.current?.handleVadSpeechEnd(),
                  onMisfire: () => driverRef.current?.handleVadMisfire(),
                });
              }
            : undefined,
        hooks: {
          onStateChange: (state) => {
            applyState(state);
            // Manual tap-stop leaves the transcript for the composer: take it exactly once.
            const driver = driverRef.current;
            if (
              driver &&
              driver.mode === 'manual' &&
              state.status === IDLE &&
              state.transcript.trim()
            ) {
              const text = driver.takeTranscript();
              if (text) optsRef.current.onManualTranscript(text);
            }
          },
          onLevel: setLevel,
          onSendTranscript: (text) => {
            optsRef.current.onSendTranscript(text);
            // Best-effort turn_committed: refs only, resolved from the store after the
            // send path persisted the user message (talking mode keeps the stream open).
            setTimeout(() => {
              const driver = driverRef.current;
              const sessionId = optsRef.current.sessionId;
              if (!driver || !sessionId) return;
              const messages = useOrchestrationStore.getState().messages[sessionId] ?? [];
              const match = [...messages].reverse().find((m) => m.role === 'user' && m.content === text);
              if (match) driver.commitTurn(match.id);
            }, 0);
          },
          onPendingNote: (text) => optsRef.current.onPendingNote(text),
          onError: setError,
          onLatencyMark: (mark, atMs) => {
            // The C1 relay logs per-stage latency server-side; this is the client mirror
            // (BRIEF §5 validation: instrumentation kept, dashboarded in C7).
            console.info(JSON.stringify({ evt: 'voice.client_latency', mark, atMs }));
          },
        },
      };
      return new VoiceSessionDriver(driverMode, deps);
    },
    [applyState, ensureSpeech],
  );

  /** Start (or tap into) a session in the given mode. Runs synchronously up to the driver
   *  tap (unlock happens inside tapMic before any await - the iOS rule). */
  const begin = useCallback(
    (wanted: VoiceMode) => {
      if (support.ok !== true) return;
      setError(null);
      setSuspended(false);
      let driver = driverRef.current;
      if (driver && driver.mode !== wanted) {
        driver.dispose();
        driver = null;
      }
      if (!driver) {
        driver = createDriver(wanted);
        driverRef.current = driver;
        setMode(wanted);
      }
      driver.tapMic();
    },
    [support, createDriver],
  );

  const tapMic = useCallback(() => {
    const driver = driverRef.current;
    if (driver && driver.getState().status !== IDLE) {
      driver.tapMic(); // manual stop-capture / talking-loop exit
      return;
    }
    begin(driverRef.current?.mode ?? 'manual');
  }, [begin]);

  const startTalking = useCallback(() => {
    const driver = driverRef.current;
    if (driver && driver.mode === 'talking' && driver.getState().status !== IDLE) return;
    if (driver && driver.getState().status !== IDLE) driver.close();
    begin('talking');
  }, [begin]);

  const sendNow = useCallback(() => {
    driverRef.current?.sendNow();
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  /* ------------------------- reply progress from the store ------------------------- */

  // Streamed reply text feeds the driver as replyStarted + replyTextChunk deltas (the
  // reducer ignores them outside a voice turn, so feeding unconditionally is safe).
  useEffect(() => {
    const sessionId = opts.sessionId;
    if (!sessionId) return;
    streamedLenRef.current = (useOrchestrationStore.getState().streamingChat[sessionId] ?? '').length;
    return useOrchestrationStore.subscribe((s) => {
      const driver = driverRef.current;
      if (!driver) return;
      const text = s.streamingChat[sessionId] ?? '';
      const prev = streamedLenRef.current;
      if (text.length < prev) {
        streamedLenRef.current = text.length; // new turn reset
        return;
      }
      if (text.length === prev) return;
      const delta = text.slice(prev);
      streamedLenRef.current = text.length;
      if (prev === 0) driver.notifyReplyStarted();
      driver.notifyReplyChunk(delta);
    });
  }, [opts.sessionId]);

  // The run settling (isExecuting flipping false) is the drain point: flush the sentence
  // tail and let the driver re-arm once the speech queue empties (agentDone).
  const prevExecutingRef = useRef(opts.isExecuting);
  useEffect(() => {
    const was = prevExecutingRef.current;
    prevExecutingRef.current = opts.isExecuting;
    if (was && !opts.isExecuting) {
      streamedLenRef.current = 0;
      driverRef.current?.notifyRunSettled();
    }
  }, [opts.isExecuting]);

  /* ------------------------------ lifecycle honesty ------------------------------ */

  // Backgrounding/screen lock kills the mic: tear down and offer the manual resume
  // (BRIEF §5 mobile checklist, decided: reflect state honestly, one-tap resume).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      const driver = driverRef.current;
      if (driver && driver.getState().status !== IDLE) {
        driver.close();
        setSuspended(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onVisibility);
    };
  }, []);

  // Session switch / unmount: full teardown.
  useEffect(() => {
    return () => {
      driverRef.current?.dispose();
      driverRef.current = null;
      setMode(null);
      setSuspended(false);
    };
  }, [opts.sessionId]);

  // True unmount only: close the speech channel's OWN resources - the tts socket and the
  // playback AudioContext (fix 2). Not on session switch: the channel (and its unlocked
  // context - the iOS gesture privilege) deliberately survives across driver instances
  // while the composer stays mounted.
  useEffect(() => {
    return () => {
      speechRef.current?.clear(); // silence + drop queued sentences before closing
      speechSocketRef.current?.close();
      void speechCtxRef.current?.close?.().catch(() => {
        /* already closed */
      });
      speechRef.current = null;
      speechSocketRef.current = null;
      speechCtxRef.current = null;
    };
  }, []);

  return {
    support,
    mode,
    status,
    interim,
    level,
    suspended,
    error,
    tapMic,
    startTalking,
    sendNow,
    dismissError,
  };
}
