/**
 * STT WebSocket client (mega-run C4): the THIN transport over WS /api/voice/stream. All
 * message framing/validation is wire.ts (pure); this file only owns the socket lifecycle.
 * The WebSocket constructor is injected so the host driver is testable with a fake socket
 * (no browser, no network). Binary frames go UP (16 kHz linear16 PCM from the worklet);
 * validated JSON events come DOWN. Never reconnects on its own - the voice machine owns
 * lifecycle honesty (a dropped socket surfaces as state, never a silent retry).
 */
import type { VoiceLang, VoiceSttServerMessage } from '@ekoa/shared';
import { parseSttServerMessage, serializeSttClientMessage, sttStreamUrl } from './wire';

/** Structural WebSocket surface used (constructor-injectable for tests). The handler slots
 *  are typed `(ev: never) => void` - the widest supertype of both the real DOM handlers and
 *  our own (we only ever ASSIGN handlers here, never invoke them), which is what lets a real
 *  `WebSocket` satisfy this interface without casts. */
export interface WebSocketLike {
  binaryType: string;
  readyState: number;
  send(data: ArrayBuffer | string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: never) => void) | null;
  onmessage: ((ev: never) => void) | null;
  onclose: ((ev: never) => void) | null;
  onerror: ((ev: never) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const WS_OPEN = 1;

export interface SttSocketOpts {
  baseUrl: string;
  token: string;
  sampleRate: number;
  utteranceEndMs?: number;
  lang?: VoiceLang;
  createWebSocket: WebSocketFactory;
  onMessage: (msg: VoiceSttServerMessage) => void;
  /** Fires once, on ANY close (clean or dropped). expected=true when close() was called. */
  onClose: (info: { expected: boolean }) => void;
}

export interface SttSocket {
  open(): Promise<void>;
  sendAudio(frame: ArrayBuffer): void;
  /** Ask the relay to flush + finalize the provider stream (it closes the socket after). */
  sendCloseStream(): void;
  /** Annotate the last finished turn with its chat-message ref (refs only, never text). */
  sendTurnCommitted(transcriptMessageId: string, mode: 'manual' | 'talking'): void;
  close(): void;
  readonly isOpen: boolean;
}

export function createSttSocket(opts: SttSocketOpts): SttSocket {
  let ws: WebSocketLike | null = null;
  let expected = false;
  let closed = true; // no socket yet; open() arms a fresh generation

  const notifyClose = (socket: WebSocketLike): void => {
    if (socket !== ws || closed) return; // a stale generation's close is not ours
    closed = true;
    opts.onClose({ expected });
  };

  return {
    /** Dial a fresh socket. Reusable: each open() starts a new generation (the driver
     *  re-opens after a manual turn closed the previous stream). */
    open(): Promise<void> {
      return new Promise((resolve, reject) => {
        const url = sttStreamUrl(opts.baseUrl, {
          token: opts.token,
          sampleRate: opts.sampleRate,
          utteranceEndMs: opts.utteranceEndMs,
          lang: opts.lang,
        });
        const socket = opts.createWebSocket(url);
        socket.binaryType = 'arraybuffer';
        socket.onopen = () => resolve();
        socket.onmessage = (ev: { data: unknown }) => {
          if (socket !== ws) return; // stale generation
          // After a deliberate close() (expected) or a completed close, drop late frames -
          // a queued {type:'error'} must not raise a spurious error after a user stop.
          if (expected || closed) return;
          if (typeof ev.data !== 'string') return; // no binary comes down this channel
          const msg = parseSttServerMessage(ev.data);
          if (msg) opts.onMessage(msg);
        };
        socket.onerror = () => reject(new Error('voice stt socket failed'));
        socket.onclose = () => {
          reject(new Error('voice stt socket closed')); // no-op if already resolved
          notifyClose(socket);
        };
        ws = socket;
        expected = false;
        closed = false;
      });
    },
    sendAudio(frame: ArrayBuffer): void {
      if (ws && ws.readyState === WS_OPEN) ws.send(frame);
    },
    sendCloseStream(): void {
      if (ws && ws.readyState === WS_OPEN) {
        ws.send(serializeSttClientMessage({ type: 'close_stream' }));
      }
    },
    sendTurnCommitted(transcriptMessageId: string, mode: 'manual' | 'talking'): void {
      if (ws && ws.readyState === WS_OPEN) {
        ws.send(serializeSttClientMessage({ type: 'turn_committed', transcriptMessageId, mode }));
      }
    },
    close(): void {
      expected = true;
      try {
        ws?.close(1000, 'client-closed');
      } catch {
        /* already closed */
      }
      if (ws) notifyClose(ws);
    },
    get isOpen(): boolean {
      return ws !== null && ws.readyState === WS_OPEN && !closed;
    },
  };
}
