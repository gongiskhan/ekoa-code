/**
 * TTS WebSocket client (mega-run C4): the THIN transport over WS /api/voice/tts-stream.
 * Lazy-opening (the socket dials on the first say and is reused across turns; the server's
 * 10-minute inactivity timeout may close it, so say() re-dials a dead socket), with all
 * framing/validation in wire.ts. Binary frames DOWN are synthesized audio (complete WAV
 * files split anywhere across frames - wav.ts reassembles); JSON runs both ways.
 */
import type { VoiceLang, VoiceTtsServerMessage } from '@ekoa/shared';
import { parseTtsServerMessage, serializeTtsClientMessage, ttsStreamUrl } from './wire';
import type { WebSocketFactory, WebSocketLike } from './stt-socket';

const WS_OPEN = 1;

export interface TtsSocketOpts {
  baseUrl: string;
  /** Read at (re)dial time so a refreshed session token is always used. */
  getToken: () => string | null;
  createWebSocket: WebSocketFactory;
  onMessage: (msg: VoiceTtsServerMessage) => void;
  onAudio: (frame: Uint8Array) => void;
  /** A dropped socket mid-turn (the next say() re-dials). */
  onDrop?: () => void;
}

export interface TtsSocket {
  /** Send a say (dials/re-dials as needed). Resolves once the message is on the wire. */
  say(text: string, lang: VoiceLang, ids?: { turnId?: string; sheetId?: string }): Promise<void>;
  /** Barge-in: abort the in-flight synthesis. No-op when the socket is not open. */
  clear(): void;
  close(): void;
}

export function createTtsSocket(opts: TtsSocketOpts): TtsSocket {
  let ws: WebSocketLike | null = null;
  let opening: Promise<void> | null = null;
  // Monotonic say token: clear() bumps it so a say() awaiting the socket open discovers it
  // was superseded and never sends the stale text (barge-in during socket opening).
  let sayGen = 0;

  const ensureOpen = (): Promise<void> => {
    if (ws && ws.readyState === WS_OPEN) return Promise.resolve();
    if (opening) return opening;
    opening = new Promise<void>((resolve, reject) => {
      const token = opts.getToken();
      if (!token) {
        reject(new Error('voice tts: no session token'));
        return;
      }
      const socket = opts.createWebSocket(ttsStreamUrl(opts.baseUrl, { token }));
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => resolve();
      socket.onmessage = (ev: { data: unknown }) => {
        if (typeof ev.data === 'string') {
          const msg = parseTtsServerMessage(ev.data);
          if (msg) opts.onMessage(msg);
          return;
        }
        if (ev.data instanceof ArrayBuffer) opts.onAudio(new Uint8Array(ev.data));
      };
      socket.onerror = () => reject(new Error('voice tts socket failed'));
      socket.onclose = () => {
        reject(new Error('voice tts socket closed')); // no-op when already open
        if (ws === socket) {
          ws = null;
          opts.onDrop?.();
        }
      };
      ws = socket;
    }).finally(() => {
      opening = null;
    });
    return opening;
  };

  return {
    async say(text, lang, ids): Promise<void> {
      const gen = ++sayGen;
      await ensureOpen();
      // A clear() (barge-in) arriving while the socket was opening bumped sayGen: the
      // synthesis was cancelled before it started, so do NOT send the stale say.
      if (gen !== sayGen) return;
      ws?.send(
        serializeTtsClientMessage({
          type: 'say',
          text,
          lang,
          ...(ids?.turnId ? { turnId: ids.turnId } : {}),
          ...(ids?.sheetId ? { sheetId: ids.sheetId } : {}),
        }),
      );
    },
    clear(): void {
      sayGen++; // cancel any say still awaiting the socket open
      if (ws && ws.readyState === WS_OPEN) {
        ws.send(serializeTtsClientMessage({ type: 'clear' }));
      }
    },
    close(): void {
      try {
        ws?.close(1000, 'client-closed');
      } catch {
        /* already closed */
      }
      ws = null;
    },
  };
}
