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

/**
 * Input events sent UP to the live browser, in the COMPONENT's vocabulary. These are translated to
 * the server's on-wire `mouse`/`key` messages inside `sendInput` (see `toWireMessage`), which is the
 * one place that knows the media-channel protocol (`api/src/streaming/protocol.ts`).
 */
export type CanvasInputEvent =
  | { type: 'mousemove'; x: number; y: number }
  | { type: 'mousedown'; x: number; y: number; button?: number }
  | { type: 'mouseup'; x: number; y: number; button?: number }
  | { type: 'click'; x: number; y: number; button?: number }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'keydown'; key: string; code?: string; modifiers?: string[] }
  | { type: 'keyup'; key: string; code?: string; modifiers?: string[] }
  | { type: 'text'; text: string };

/** DOM MouseEvent.button (0/1/2) → the server's button enum. `move` carries no button. */
function wireButton(button: number | undefined): 'left' | 'middle' | 'right' {
  return button === 1 ? 'middle' : button === 2 ? 'right' : 'left';
}

/** The component builds modifiers as `['Meta','Control','Alt','Shift']`; the server wants a flag
 *  object. Translated here so the component never has to know the wire shape. */
function wireModifiers(names: string[] | undefined): { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean } {
  const set = new Set(names ?? []);
  return {
    ...(set.has('Alt') ? { alt: true } : {}),
    ...(set.has('Control') ? { ctrl: true } : {}),
    ...(set.has('Meta') ? { meta: true } : {}),
    ...(set.has('Shift') ? { shift: true } : {}),
  };
}

/**
 * Translate a component input event to the on-wire `ClientMessage` (`api/src/streaming/protocol.ts`).
 * Returns null for events the wire has no representation for (`click`, `text`) — `click` is already
 * covered by the mousedown/up pair the component also sends, and `text` is not a media-channel
 * message. Returning null rather than inventing a shape keeps the two protocols honest.
 */
function toWireMessage(event: CanvasInputEvent): Record<string, unknown> | null {
  switch (event.type) {
    case 'mousemove':
      return { type: 'mouse', action: 'move', x: event.x, y: event.y, button: 'none' };
    case 'mousedown':
      return { type: 'mouse', action: 'down', x: event.x, y: event.y, button: wireButton(event.button) };
    case 'mouseup':
      return { type: 'mouse', action: 'up', x: event.x, y: event.y, button: wireButton(event.button) };
    case 'wheel':
      return { type: 'mouse', action: 'wheel', x: event.x, y: event.y, deltaX: event.deltaX, deltaY: event.deltaY };
    case 'keydown':
      return { type: 'key', action: 'down', key: event.key, code: event.code ?? '', modifiers: wireModifiers(event.modifiers) };
    case 'keyup':
      return { type: 'key', action: 'up', key: event.key, code: event.code ?? '', modifiers: wireModifiers(event.modifiers) };
    case 'click':
    case 'text':
    default:
      return null;
  }
}

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
  /** A frame arrives as a ready-to-paint `data:image/jpeg;base64,...` URL. */
  onFrame(fn: (frameDataUrl: string) => void): Unsubscribe;
  onStatusChange(fn: (status: CanvasStatus) => void): Unsubscribe;
  /** `resumed` is true for the normal (1000) hand-back close; false for takeover (4000)/errors. */
  onClose(fn: (code: number, resumed: boolean) => void): Unsubscribe;
  onViewport(fn: (viewport: { width: number; height: number }) => void): Unsubscribe;
  sendInput(event: CanvasInputEvent): void;
  /** Close the channel. Defaults to a normal (1000) hand-back close. */
  close(code?: number): void;
}

class LiveCanvas implements CanvasSession {
  viewport: { width: number; height: number };
  private ws: WebSocket | null = null;
  private _status: CanvasStatus = 'connecting';
  private readonly frameSubs = new Set<(frame: string) => void>();
  private readonly statusSubs = new Set<(status: CanvasStatus) => void>();
  private readonly closeSubs = new Set<(code: number, resumed: boolean) => void>();
  private readonly viewportSubs = new Set<(viewport: { width: number; height: number }) => void>();

  constructor(opts: CanvasOpenOptions) {
    this.viewport = opts.viewport;
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
      this._status = 'closed';
      return;
    }
    const sep = opts.wsUrl.includes('?') ? '&' : '?';
    const ws = new WebSocket(`${opts.wsUrl}${sep}token=${encodeURIComponent(opts.token)}`);
    this.ws = ws;

    ws.onopen = () => this.setStatus('open');
    ws.onmessage = (event: MessageEvent) => this.handleServerMessage(event.data);
    ws.onclose = (event: CloseEvent) => {
      this.setStatus('closed');
      const resumed = event.code === CANVAS_CLOSE_NORMAL;
      for (const fn of [...this.closeSubs]) fn(event.code, resumed);
    };
    ws.onerror = () => {
      // A failed socket surfaces through onclose; nothing extra to do.
    };
  }

  /**
   * The server media channel is TEXT JSON (`api/src/streaming/protocol.ts`): a `frame` carries a
   * base64 JPEG, a `viewport` re-sizes the canvas, `error`/`pong` are control. Every frame is ACKed
   * by seq — the server bounds its in-flight backlog to 3 unacked frames and stops FORWARDING the
   * screencast past that (session.ts), so a client that never acks silently degrades to the 2fps
   * screenshot-poll fallback. Acking here is what keeps the stream at full frame rate.
   */
  private handleServerMessage(data: unknown): void {
    if (typeof data !== 'string') return; // the channel is text-only; a binary frame is not ours
    let msg: { type?: string; seq?: number; jpegBase64?: string; width?: number; height?: number };
    try {
      msg = JSON.parse(data);
    } catch {
      return; // a frame we cannot parse is dropped rather than crashing the socket
    }
    if (msg.type === 'frame' && typeof msg.jpegBase64 === 'string') {
      if (typeof msg.seq === 'number') this.sendRaw({ type: 'frame_ack', seq: msg.seq });
      const dataUrl = `data:image/jpeg;base64,${msg.jpegBase64}`;
      for (const fn of [...this.frameSubs]) fn(dataUrl);
    } else if (msg.type === 'viewport' && typeof msg.width === 'number' && typeof msg.height === 'number') {
      this.viewport = { width: msg.width, height: msg.height };
      for (const fn of [...this.viewportSubs]) fn(this.viewport);
    }
    // 'error'/'pong' need no client action today.
  }

  get status(): CanvasStatus {
    return this._status;
  }

  onFrame(fn: (frame: string) => void): Unsubscribe {
    this.frameSubs.add(fn);
    return () => {
      this.frameSubs.delete(fn);
    };
  }

  onViewport(fn: (viewport: { width: number; height: number }) => void): Unsubscribe {
    this.viewportSubs.add(fn);
    return () => {
      this.viewportSubs.delete(fn);
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
    const wire = toWireMessage(event);
    if (wire) this.sendRaw(wire);
  }

  /** Send an already-wire-shaped message (input or frame_ack). Guards the socket state so a message
   *  built after a close is a no-op rather than a throw. */
  private sendRaw(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
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
