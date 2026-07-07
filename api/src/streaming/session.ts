/**
 * streaming/session.ts — one live-canvas session (B17 port): a Playwright CDP screencast
 * relayed down a WebSocket as JPEG frames, mouse/keyboard input relayed up. Input is gated:
 * only dispatched while the run reports `paused_for_user` (state gate) AND the session is
 * open. Close-code contract (landmine 8): a socket-level takeover closes the displaced socket
 * with 4000 ('replaced') — the client must NOT reconnect after 4000; a normal teardown uses
 * 1000. Frames are never logged (privacy). Tunables come from EKOA_STREAMING_* env.
 */
import type { CDPSession, Page } from 'playwright';
import type { WebSocket } from 'ws';
import {
  ackFrame,
  dispatchKeyEvent,
  dispatchMouseEvent,
  getViewport,
  newCdpSession,
  startScreencast,
  stopScreencast,
  type ScreencastFrame,
} from './cdp.js';
import {
  modifiersToBits,
  type ClientMessage,
  type KeyMessage,
  type MouseMessage,
  type ServerMessage,
} from './protocol.js';

const FPS = parseInt(process.env.EKOA_STREAMING_FPS || '15', 10);
const QUALITY = parseInt(process.env.EKOA_STREAMING_QUALITY || '70', 10);
const MAX_FRAME_BACKLOG = parseInt(process.env.EKOA_STREAMING_MAX_FRAME_BACKLOG || '3', 10);
// Headless CDP screencast only fires on actual repaints. A static page (e.g. a
// solved CAPTCHA waiting for the user) emits no frames after initial render,
// leaving the canvas black. Poll captureScreenshot at this rate as a fallback;
// the screencast path still drives fast updates when the page is dynamic.
const POLL_INTERVAL_MS = parseInt(process.env.EKOA_STREAMING_POLL_INTERVAL_MS || '500', 10);
/** Max pending (queued + in-flight) input dispatches before new input is dropped (backpressure). */
const MAX_QUEUED_INPUT = parseInt(process.env.EKOA_STREAMING_MAX_QUEUED_INPUT || '32', 10);

export type RunStateProbe = () => 'paused_for_user' | 'other';

export interface StreamSessionOptions {
  traceId: string;
  page: Page;
  ownerUserId: string;
  isPaused: RunStateProbe;
  onLog?: (event: string, fields: Record<string, unknown>) => void;
}

export class StreamSession {
  readonly traceId: string;
  readonly ownerUserId: string;
  private page: Page;
  private cdp: CDPSession | null = null;
  private socket: WebSocket | null = null;
  private viewport: { width: number; height: number } = { width: 1280, height: 800 };
  private frameSeq = 0;
  private framesInFlight = 0;
  private isPaused: RunStateProbe;
  private closed = false;
  private onLog: (event: string, fields: Record<string, unknown>) => void;
  private inputBatchCount = 0;
  private openedAt = Date.now();
  private inputAllowed = true;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastFrameAt = 0;
  // Input backpressure (Codex G8): dispatch is serialized through one CDP chain and the number of
  // queued inputs is bounded, so a flood of tiny valid mouse/key messages cannot pile up unbounded
  // pending CDP promises and exhaust the process/browser.
  private inputChain: Promise<void> = Promise.resolve();
  private inputQueued = 0;

  constructor(opts: StreamSessionOptions) {
    this.traceId = opts.traceId;
    this.ownerUserId = opts.ownerUserId;
    this.page = opts.page;
    this.isPaused = opts.isPaused;
    this.onLog = opts.onLog ?? (() => {});
  }

  async open(): Promise<void> {
    this.cdp = await newCdpSession(this.page);
    this.viewport = await getViewport(this.page);

    this.cdp.on('Page.screencastFrame', (frame) => {
      this.handleFrame(frame as ScreencastFrame).catch(() => {});
    });
    this.cdp.on('Page.frameNavigated', () => {
      // Cross-origin navigation can detach the screencast; restart it
      // best-effort. Errors are non-fatal — next user input will still
      // work via the existing CDP session.
      if (this.closed || !this.cdp) return;
      this.startScreencastBest().catch(() => {});
    });

    await this.startScreencastBest();
    this.onLog('streaming.session.opened', { traceId: this.traceId, userId: this.ownerUserId });
  }

  attachSocket(socket: WebSocket): void {
    if (this.socket) {
      // Socket-level takeover: a second client grabbed this live view. Close the
      // displaced socket with 4000 — the client must NOT reconnect (landmine 8).
      try { this.socket.close(4000, 'replaced'); } catch { /* socket already gone */ }
    }
    this.socket = socket;
    this.frameSeq = 0;
    this.framesInFlight = 0;
    this.inputAllowed = true;

    this.sendServer({ type: 'viewport', width: this.viewport.width, height: this.viewport.height });

    socket.on('message', (raw) => {
      this.handleClientMessage(raw).catch(() => {});
    });
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.stopPolling();
      }
    });
    socket.on('error', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.stopPolling();
      }
    });

    // Send an immediate screenshot so the user never sees a black canvas, then
    // start the polling fallback for static pages where screencast won't fire.
    this.sendScreenshotFrame().catch(() => {});
    this.startPolling();
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      // Only poll if the screencast hasn't delivered anything recently.
      // Saves work on dynamic pages where screencast keeps frames flowing.
      if (Date.now() - this.lastFrameAt < POLL_INTERVAL_MS) return;
      this.sendScreenshotFrame().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async sendScreenshotFrame(): Promise<void> {
    if (this.closed || !this.socket) return;
    if (this.framesInFlight >= MAX_FRAME_BACKLOG) return;
    let buf: Buffer;
    try {
      buf = await this.page.screenshot({ type: 'jpeg', quality: QUALITY });
    } catch {
      return;
    }
    if (this.closed || !this.socket) return;
    const seq = ++this.frameSeq;
    this.framesInFlight++;
    this.lastFrameAt = Date.now();
    const msg: ServerMessage = { type: 'frame', seq, jpegBase64: buf.toString('base64') };
    try {
      this.socket.send(JSON.stringify(msg), (err?: Error) => {
        this.framesInFlight = Math.max(0, this.framesInFlight - 1);
        if (err) this.socket = null;
      });
    } catch {
      this.framesInFlight = Math.max(0, this.framesInFlight - 1);
      this.socket = null;
    }
  }

  async close(reason: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.inputAllowed = false;
    this.stopPolling();
    if (this.cdp) {
      await stopScreencast(this.cdp);
      try {
        await this.cdp.detach();
      } catch {
        // CDP session may already be gone.
      }
      this.cdp = null;
    }
    if (this.socket) {
      // Normal teardown — close code 1000 (landmine 8).
      try { this.socket.close(1000, reason); } catch { /* socket already gone */ }
      this.socket = null;
    }
    this.onLog('streaming.session.closed', {
      traceId: this.traceId,
      reason,
      durationMs: Date.now() - this.openedAt,
      inputBatchCount: this.inputBatchCount,
    });
  }

  isClosed(): boolean {
    return this.closed;
  }

  hasSocket(): boolean {
    return this.socket !== null;
  }

  /** test-only: peek backlog */
  _backlog(): number {
    return this.framesInFlight;
  }

  private async startScreencastBest(): Promise<void> {
    if (!this.cdp) return;
    const everyNthFrame = Math.max(1, Math.round(60 / Math.max(1, FPS)));
    try {
      await startScreencast(this.cdp, {
        format: 'jpeg',
        quality: QUALITY,
        maxWidth: this.viewport.width,
        maxHeight: this.viewport.height,
        everyNthFrame,
      });
    } catch {
      this.close('error').catch(() => {});
    }
  }

  private async handleFrame(frame: ScreencastFrame): Promise<void> {
    if (this.closed || !this.cdp) return;
    // CDP requires every frame to be ACKed even if dropped client-side,
    // otherwise screencast stalls.
    const ackPromise = ackFrame(this.cdp, frame.sessionId);

    if (!this.socket) {
      await ackPromise;
      return;
    }
    if (this.framesInFlight >= MAX_FRAME_BACKLOG) {
      await ackPromise;
      return;
    }

    const seq = ++this.frameSeq;
    this.framesInFlight++;
    this.lastFrameAt = Date.now();
    const msg: ServerMessage = { type: 'frame', seq, jpegBase64: frame.data };
    try {
      this.socket.send(JSON.stringify(msg), (err?: Error) => {
        this.framesInFlight = Math.max(0, this.framesInFlight - 1);
        if (err) {
          // Connection dropped; clear it so backlog accounting stays sane.
          this.socket = null;
        }
      });
    } catch {
      this.framesInFlight = Math.max(0, this.framesInFlight - 1);
      this.socket = null;
    }
    await ackPromise;
  }

  private async handleClientMessage(raw: unknown): Promise<void> {
    if (this.closed) return;
    let payload: ClientMessage;
    try {
      const text = typeof raw === 'string'
        ? raw
        : Buffer.isBuffer(raw)
          ? raw.toString('utf8')
          : String(raw);
      const parsed = JSON.parse(text);
      payload = parsed as ClientMessage;
    } catch {
      return;
    }

    if (payload.type === 'ping') {
      this.sendServer({ type: 'pong', t: payload.t });
      return;
    }

    if (payload.type === 'frame_ack') {
      // We unconditionally ACK CDP frames server-side; this is a hint
      // and intentionally a no-op.
      return;
    }

    if (payload.type === 'mouse' || payload.type === 'key') {
      if (!this.inputAllowed) {
        this.onLog('streaming.auth_failure', { reason: 'state-not-paused', traceId: this.traceId });
        return;
      }
      if (this.isPaused() !== 'paused_for_user') {
        this.onLog('streaming.auth_failure', { reason: 'state-not-paused', traceId: this.traceId });
        return;
      }
      // Bounded, serialized dispatch: drop the input when the queue is already saturated (a
      // pointer move/wheel is safe to drop; the next event supersedes it) rather than growing
      // unbounded pending CDP work.
      if (this.inputQueued >= MAX_QUEUED_INPUT) {
        this.onLog('streaming.input_dropped', { reason: 'backpressure', traceId: this.traceId });
        return;
      }
      this.inputBatchCount++;
      this.inputQueued++;
      const msg = payload;
      const dispatch = this.inputChain
        .then(() => (msg.type === 'mouse' ? this.dispatchMouse(msg) : this.dispatchKey(msg)))
        .catch(() => {})
        .finally(() => { this.inputQueued--; });
      this.inputChain = dispatch;
      // The socket 'message' handler fires-and-forgets this (non-blocking read); returning the
      // dispatch promise lets a direct caller (tests) await the actual CDP dispatch.
      return dispatch;
    }
  }

  private async dispatchMouse(msg: MouseMessage): Promise<void> {
    if (!this.cdp) return;
    const modifiers = modifiersToBits(msg.modifiers);
    const button = msg.button ?? 'none';
    const x = clamp(msg.x, 0, this.viewport.width);
    const y = clamp(msg.y, 0, this.viewport.height);
    let type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
    if (msg.action === 'down') type = 'mousePressed';
    else if (msg.action === 'up') type = 'mouseReleased';
    else if (msg.action === 'wheel') type = 'mouseWheel';
    else type = 'mouseMoved';
    try {
      await dispatchMouseEvent(this.cdp, {
        type,
        x,
        y,
        button,
        modifiers,
        deltaX: msg.deltaX,
        deltaY: msg.deltaY,
      });
    } catch {
      // Page may have navigated away; CDP recovers next frame.
    }
  }

  private async dispatchKey(msg: KeyMessage): Promise<void> {
    if (!this.cdp) return;
    const modifiers = modifiersToBits(msg.modifiers);
    const type = msg.action === 'down' ? 'keyDown' : 'keyUp';
    const text = type === 'keyDown' && msg.key.length === 1 ? msg.key : undefined;
    try {
      await dispatchKeyEvent(this.cdp, { type, key: msg.key, code: msg.code, modifiers, text });
    } catch {
      // ignore
    }
  }

  private sendServer(msg: ServerMessage): void {
    if (!this.socket) return;
    try {
      this.socket.send(JSON.stringify(msg));
    } catch {
      this.socket = null;
    }
  }

  /** test-only: simulate inbound message */
  async _injectClientMessage(raw: unknown): Promise<void> {
    await this.handleClientMessage(raw);
  }

  /** test-only: read viewport */
  _viewport(): { width: number; height: number } {
    return this.viewport;
  }

  /** test-only: set viewport */
  _setViewport(v: { width: number; height: number }): void {
    this.viewport = v;
  }

  /** test-only: stub the CDP session */
  _setCdp(cdp: CDPSession | null): void {
    this.cdp = cdp;
  }

  /** test-only: increment in-flight count to test backpressure */
  _setBacklog(n: number): void {
    this.framesInFlight = n;
  }

  /** test-only: deliver a frame as if from CDP */
  async _deliverFrame(frame: ScreencastFrame): Promise<void> {
    await this.handleFrame(frame);
  }
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
