/**
 * The live browser canvas (ch12 §12.3.1, RESOLVED Q-01). When an automation run needs the
 * user to act inside the live browser (login wall, CAPTCHA, manual confirmation) it emits
 * `streaming_available` `{ token, wsUrl, viewport }` on its automation-run stream and moves
 * to `paused_for_user`. The client opens this canvas: JPEG frames stream DOWN, mouse and
 * keyboard events go UP, over a single WebSocket.
 *
 * This is the one scoped exception to FIXED-2 - a media channel, never JSON API payloads.
 * `new WebSocket(` appears ONLY in this file (acceptance criterion 15); it is the sole
 * non-SSE transport in `web/`. The short-TTL token is minted per handoff (never the session
 * JWT). Close-code contract (carryover landmine 8): `1000` normal close when the user hands
 * control back and the run resumes; `4000` takeover, which never reconnects. We never
 * auto-reconnect - both named close codes are terminal. SSR-guarded (WebSocket is browser-only).
 */

export type CanvasStatus = 'connecting' | 'open' | 'closed';
export type Unsubscribe = () => void;

/** Close codes from the ch03 §3.7 handoff contract. */
export const CANVAS_CLOSE_NORMAL = 1000;
export const CANVAS_CLOSE_TAKEOVER = 4000;

/** Input events sent UP to the live browser. Exact wire shape is owned by ch03 §3.7. */
export type CanvasInputEvent =
  | { type: 'mousemove'; x: number; y: number }
  | { type: 'mousedown'; x: number; y: number; button?: number }
  | { type: 'mouseup'; x: number; y: number; button?: number }
  | { type: 'click'; x: number; y: number; button?: number }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'keydown'; key: string; code?: string; modifiers?: string[] }
  | { type: 'keyup'; key: string; code?: string; modifiers?: string[] }
  | { type: 'text'; text: string };

export interface CanvasOpenOptions {
  /** WebSocket URL from the `streaming_available` event. */
  wsUrl: string;
  /** Short-TTL per-handoff token from the `streaming_available` event. */
  token: string;
  /** Viewport dimensions from the `streaming_available` event. */
  viewport: { width: number; height: number };
}

export interface CanvasSession {
  readonly status: CanvasStatus;
  readonly viewport: { width: number; height: number };
  onFrame(fn: (frame: Blob) => void): Unsubscribe;
  onStatusChange(fn: (status: CanvasStatus) => void): Unsubscribe;
  /** `resumed` is true for the normal (1000) hand-back close; false for takeover (4000)/errors. */
  onClose(fn: (code: number, resumed: boolean) => void): Unsubscribe;
  sendInput(event: CanvasInputEvent): void;
  /** Close the channel. Defaults to a normal (1000) hand-back close. */
  close(code?: number): void;
}

class LiveCanvas implements CanvasSession {
  readonly viewport: { width: number; height: number };
  private ws: WebSocket | null = null;
  private _status: CanvasStatus = 'connecting';
  private readonly frameSubs = new Set<(frame: Blob) => void>();
  private readonly statusSubs = new Set<(status: CanvasStatus) => void>();
  private readonly closeSubs = new Set<(code: number, resumed: boolean) => void>();

  constructor(opts: CanvasOpenOptions) {
    this.viewport = opts.viewport;
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
      this._status = 'closed';
      return;
    }
    const sep = opts.wsUrl.includes('?') ? '&' : '?';
    const ws = new WebSocket(`${opts.wsUrl}${sep}token=${encodeURIComponent(opts.token)}`);
    ws.binaryType = 'blob';
    this.ws = ws;

    ws.onopen = () => this.setStatus('open');
    ws.onmessage = (event: MessageEvent) => {
      // Binary frames are JPEG stills; string frames are control messages (ignored here).
      if (typeof event.data === 'string') return;
      const frame = event.data instanceof Blob ? event.data : new Blob([event.data as ArrayBuffer]);
      for (const fn of [...this.frameSubs]) fn(frame);
    };
    ws.onclose = (event: CloseEvent) => {
      this.setStatus('closed');
      const resumed = event.code === CANVAS_CLOSE_NORMAL;
      for (const fn of [...this.closeSubs]) fn(event.code, resumed);
    };
    ws.onerror = () => {
      // A failed socket surfaces through onclose; nothing extra to do.
    };
  }

  get status(): CanvasStatus {
    return this._status;
  }

  onFrame(fn: (frame: Blob) => void): Unsubscribe {
    this.frameSubs.add(fn);
    return () => {
      this.frameSubs.delete(fn);
    };
  }

  onStatusChange(fn: (status: CanvasStatus) => void): Unsubscribe {
    this.statusSubs.add(fn);
    return () => {
      this.statusSubs.delete(fn);
    };
  }

  onClose(fn: (code: number, resumed: boolean) => void): Unsubscribe {
    this.closeSubs.add(fn);
    return () => {
      this.closeSubs.delete(fn);
    };
  }

  sendInput(event: CanvasInputEvent): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  close(code: number = CANVAS_CLOSE_NORMAL): void {
    if (this.ws) {
      try {
        this.ws.close(code);
      } catch {
        /* ignore */
      }
    }
  }

  private setStatus(status: CanvasStatus): void {
    if (this._status === status) return;
    this._status = status;
    for (const fn of [...this.statusSubs]) fn(status);
  }
}

/** Open the live browser canvas from a `streaming_available` automation-run event. */
export function openCanvas(opts: CanvasOpenOptions): CanvasSession {
  return new LiveCanvas(opts);
}
