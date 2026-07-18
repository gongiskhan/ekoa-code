'use client';

/**
 * useOuvir (mega-run C4): the sheet footer's read-aloud action. One SheetReader per panel
 * mount, created LAZILY BUT SYNCHRONOUSLY inside the first tap (the audio unlock must run
 * in the gesture frame - the iOS rule); reused across sheets. toggle() on the speaking
 * sheet stops it; on another sheet it supersedes (the relay's say-supersedes-say rule).
 * The raw markdown goes up as-is: the api-side C5 pipeline sanitizes + normalizes before
 * synthesis. Language rides the locale (BRIEF §5, decided: locale-only resolution).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveBaseUrl } from '@/lib/api/base-url';
import { getToken } from '@/lib/api/token';
import { useI18nStore } from '@/stores/i18n';
import { createTtsSocket, type TtsSocket } from '@/lib/voice/tts-socket';
import { TtsPlayback, type AudioContextLike } from '@/lib/voice/tts-playback';
import { SheetReader, type SheetReaderStatus } from '@/lib/voice/sheet-reader';
import { voiceLangForLocale } from '@/lib/voice/wire';

export interface OuvirApi {
  /** The sheet currently loading/being read aloud, or null. */
  speakingSheetId: string | null;
  status: SheetReaderStatus;
  /** True when read-aloud can work here (needs WebSocket + Web Audio; not SSR). */
  available: boolean;
  /** Tap handler: start reading this sheet, or stop if it is the one speaking. */
  toggle: (sheetId: string, text: string) => void;
  error: boolean;
  dismissError: () => void;
}

export function useOuvir(): OuvirApi {
  const [speakingSheetId, setSpeakingSheetId] = useState<string | null>(null);
  const [status, setStatus] = useState<SheetReaderStatus>('idle');
  const [error, setError] = useState(false);
  const readerRef = useRef<SheetReader | null>(null);
  const socketRef = useRef<TtsSocket | null>(null);
  const ctxRef = useRef<AudioContextLike | null>(null);

  const available =
    typeof window !== 'undefined' &&
    typeof window.WebSocket === 'function' &&
    (typeof window.AudioContext === 'function' ||
      typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext === 'function');

  /** Synchronous factory - safe to run inside the tap handler. */
  const ensureReader = useCallback((): SheetReader => {
    if (readerRef.current) return readerRef.current;
    const playback = new TtsPlayback({
      createContext: () => {
        const ctx = new (window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext)() as unknown as AudioContextLike;
        ctxRef.current = ctx; // owned here; closed on unmount alongside the socket
        return ctx;
      },
      onPlaybackStart: () => readerRef.current?.handlePlaybackStart(),
      onPlaybackEnd: () => readerRef.current?.handlePlaybackEnd(),
    });
    const socket = createTtsSocket({
      baseUrl: resolveBaseUrl(),
      getToken,
      createWebSocket: (url) => new WebSocket(url),
      onMessage: (msg) => readerRef.current?.handleMessage(msg),
      onAudio: (frame) => readerRef.current?.handleAudio(frame),
      onDrop: () => readerRef.current?.handleSocketDrop(),
    });
    socketRef.current = socket;
    readerRef.current = new SheetReader({
      socket,
      playback,
      hooks: {
        onStatus: (next, sheetId) => {
          setStatus(next);
          setSpeakingSheetId(sheetId);
        },
        onError: () => setError(true),
      },
    });
    return readerRef.current;
  }, []);

  const toggle = useCallback(
    (sheetId: string, text: string) => {
      if (!available || !text.trim()) return;
      setError(false);
      const reader = ensureReader();
      if (reader.currentSheetId === sheetId) {
        reader.stop();
        return;
      }
      reader.speak(text, voiceLangForLocale(useI18nStore.getState().language), sheetId);
    },
    [available, ensureReader],
  );

  const dismissError = useCallback(() => setError(false), []);

  // Unmount: silence + drop the socket and the playback context.
  useEffect(
    () => () => {
      readerRef.current?.stop();
      socketRef.current?.close();
      void ctxRef.current?.close?.().catch(() => {
        /* already closed */
      });
      readerRef.current = null;
      socketRef.current = null;
      ctxRef.current = null;
    },
    [],
  );

  return { speakingSheetId, status, available, toggle, error, dismissError };
}
