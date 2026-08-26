/**
 * attended/screencast.ts — the DAEMON PRODUCER for the attended-ceremony live stream
 * (D-CEREMONY-STREAM). Given a minimal CDP session over the ceremony's live window, it screencasts
 * the window UP to Cortex as `ceremony.frame` JPEGs and dispatches the human's mouse/keyboard back
 * DOWN into the page with CDP `Input.dispatch*`. It is the machine-side twin of the hosted live
 * canvas (`api/src/streaming/session.ts` + `cdp.ts`), reimplemented here because the daemon CANNOT
 * import from `api/`.
 *
 * ── CREDENTIAL PRIVACY (NON-NEGOTIABLE) ──────────────────────────────────────────────────────────
 * This producer handles two kinds of credential-bearing material and must NEVER log either:
 *   - a `CeremonyInputEvent` is the human typing into a LOGIN page, so `event`, `key` and any `text`
 *     may each be one character of a password;
 *   - a `Page.screencastFrame` is a picture of that same login page (`jpegBase64`).
 * There is therefore no `console`/`log` call anywhere in this file, and none may be added — not of
 * `event`, `key`, `text` or `jpegBase64`, and not "just the length" either. Errors from CDP are
 * swallowed structurally (the page may simply be gone); nothing about a frame or a keystroke is ever
 * emitted. The `ceremony.frame` itself rides the same no-log, redactor-bypassing path as
 * `tool.result.screenshotB64` (it is an image, not text) and travels only up the WS to Cortex.
 *
 * ── RATE CONTROL, NOT VIEWER BACKPRESSURE ────────────────────────────────────────────────────────
 * Each `Page.screencastFrame` is ACKed back to Chrome IMMEDIATELY (`Page.screencastFrameAck` with the
 * frame's `sessionId`) and relayed straight up. There is NO viewer-side in-flight cap here, and there
 * cannot be: the dashboard's frame acks go to CORTEX, not to this daemon, so a count of
 * "unacked-by-viewer" frames would only ever grow and stall the stream. Chrome's own screencast is
 * ack-gated (it will not emit the next frame until the previous one is acked) and `everyNthFrame`
 * bounds the rate; Cortex does the relay-side backpressure, dropping frames when the dashboard socket
 * is slow. So the daemon's job is the simplest possible: ack, relay, repeat.
 */
import type { BridgeFrame, CeremonyInputEvent } from '../wire/index.js';
import type { BridgeCdpSession } from '../browser/chrome-launch.js';

/** Same tunables the hosted canvas reads (`api/src/streaming/session.ts`), so the two ends agree on
 *  quality and cadence. Read once at load; a bad value folds to the safe default via `Math.max`. */
const FPS = parseInt(process.env.EKOA_STREAMING_FPS || '15', 10);
const QUALITY = parseInt(process.env.EKOA_STREAMING_QUALITY || '70', 10);

/** The shape CDP delivers on `Page.screencastFrame`. Only the two fields this producer touches. */
interface ScreencastFrameEvent {
  /** Base64 JPEG of the window. NEVER logged — it is a picture of the login page. */
  data: string;
  /** Echoed straight back in the ack so Chrome releases the next frame. */
  sessionId: number;
}

/** CDP modifier bitmask: alt=1, ctrl=2, meta=4, shift=8 (mirrors `api/src/streaming/cdp.ts`). The
 *  param mirrors the wire shape (each flag `boolean | undefined` under `exactOptionalPropertyTypes`). */
type Modifiers =
  | { alt?: boolean | undefined; ctrl?: boolean | undefined; meta?: boolean | undefined; shift?: boolean | undefined }
  | undefined;
function modifiersToBits(m: Modifiers): number {
  if (!m) return 0;
  return (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);
}

/**
 * A live screencast of ONE ceremony window. Constructed only once a viewer connects
 * (`ceremony.stream{on:true}`), torn down on `{on:false}` or when the ceremony ends. Owns the one
 * CDP session that both screencasts frames up and dispatches input down.
 */
export class CeremonyScreencast {
  private seq = 0;
  private started = false;
  private stopped = false;

  constructor(
    private readonly cdp: BridgeCdpSession,
    private readonly send: (frame: BridgeFrame) => boolean,
    private readonly requestId: string,
  ) {}

  /**
   * Begin the screencast: enable the Page domain on this (separate) CDP channel, register the frame
   * handler, and start the screencast at the configured quality/cadence. Idempotent — a second
   * `ceremony.stream{on:true}` for an already-running stream is a no-op.
   */
  async start(): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    this.cdp.on('Page.screencastFrame', (payload) => {
      void this.onFrame(payload as ScreencastFrameEvent);
    });
    // `Page.enable` first: a fresh CDP session (`newCDPSession`) is a separate channel from
    // Playwright's own, so screencast frames will not fire until Page is enabled on THIS one.
    await this.cdp.send('Page.enable');
    // everyNthFrame from FPS exactly as the hosted canvas derives it: at 15fps Chrome emits every
    // 4th compositor frame (~15/s off a 60Hz pipeline).
    const everyNthFrame = Math.max(1, Math.round(60 / Math.max(1, FPS)));
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: QUALITY,
      everyNthFrame,
    });
  }

  /**
   * One screencast frame from Chrome: ack it (so Chrome releases the next) and relay it up. No
   * gating — see the rate-control note in the file docblock. The frame's base64 is NEVER logged.
   */
  private async onFrame(frame: ScreencastFrameEvent): Promise<void> {
    if (this.stopped) return;
    // Ack Chrome first so the pipeline keeps producing even if the relay is momentarily slow, then
    // send the frame up. `seq` increments per frame so Cortex/the dashboard can order them.
    const ack = this.ack(frame.sessionId);
    this.send({ type: 'ceremony.frame', requestId: this.requestId, seq: ++this.seq, jpegBase64: frame.data });
    await ack;
  }

  private async ack(sessionId: number): Promise<void> {
    try {
      await this.cdp.send('Page.screencastFrameAck', { sessionId });
    } catch {
      /* the stream was torn down; nothing to ack */
    }
  }

  /** Stop the screencast. Swallows errors — by the time a stop arrives the page may already be gone. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      await this.cdp.send('Page.stopScreencast');
    } catch {
      /* the page may already be closed */
    }
  }

  /**
   * Dispatch ONE input event the human produced in the dashboard into the live page. Fire-and-forget
   * (the socket read path does not await it); a CDP failure after a navigation is swallowed because
   * the next event recovers. NEVER logs the event.
   */
  dispatchInput(event: CeremonyInputEvent): void {
    if (this.stopped) return;
    if (event.type === 'mouse') void this.dispatchMouse(event);
    else void this.dispatchKey(event);
  }

  private async dispatchMouse(e: Extract<CeremonyInputEvent, { type: 'mouse' }>): Promise<void> {
    const type =
      e.action === 'down'
        ? 'mousePressed'
        : e.action === 'up'
          ? 'mouseReleased'
          : e.action === 'wheel'
            ? 'mouseWheel'
            : 'mouseMoved';
    try {
      await this.cdp.send('Input.dispatchMouseEvent', {
        type,
        x: e.x,
        y: e.y,
        button: e.button ?? 'none',
        modifiers: modifiersToBits(e.modifiers),
        clickCount: type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0,
        ...(e.deltaX !== undefined ? { deltaX: e.deltaX } : {}),
        ...(e.deltaY !== undefined ? { deltaY: e.deltaY } : {}),
      });
    } catch {
      /* the page may have navigated; CDP recovers on the next event */
    }
  }

  private async dispatchKey(e: Extract<CeremonyInputEvent, { type: 'key' }>): Promise<void> {
    const type = e.action === 'down' ? 'keyDown' : 'keyUp';
    // A single printable character is delivered as `text` too, so the page receives the character and
    // not only the key event — the same rule the hosted canvas follows. This value is a keystroke and
    // is NEVER logged.
    const text = type === 'keyDown' && e.key.length === 1 ? e.key : undefined;
    try {
      await this.cdp.send('Input.dispatchKeyEvent', {
        type,
        key: e.key,
        code: e.code,
        modifiers: modifiersToBits(e.modifiers),
        ...(text !== undefined ? { text } : {}),
      });
    } catch {
      /* ignore — the next event recovers */
    }
  }
}

/**
 * The handle the daemon runtime holds to drive ONE ceremony's stream. It attaches the screencast
 * LAZILY — the CDP session and the `Page.startScreencast` only happen on the first `start()`, so a
 * ceremony nobody is watching costs no frames. `stop()` is idempotent and is also what the ceremony's
 * `finally` calls to tear the stream down when the window ends.
 */
export class CeremonyStreamController {
  private screencast: CeremonyScreencast | null = null;
  private starting: Promise<void> | null = null;
  private torndown = false;

  constructor(
    private readonly newCdp: () => Promise<BridgeCdpSession>,
    private readonly send: (frame: BridgeFrame) => boolean,
    private readonly requestId: string,
  ) {}

  /** A viewer connected: attach the screencast if it is not already up. Concurrent starts join. */
  async start(): Promise<void> {
    if (this.torndown || this.screencast) return;
    if (this.starting) return this.starting;
    this.starting = (async (): Promise<void> => {
      const cdp = await this.newCdp();
      // A stop/teardown that raced the CDP attach wins: do not start a stream nobody is waiting for.
      if (this.torndown) {
        return;
      }
      const sc = new CeremonyScreencast(cdp, this.send, this.requestId);
      this.screencast = sc;
      await sc.start();
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** The viewer dropped (`ceremony.stream{on:false}`): stop the screencast but keep the window, so a
   *  later viewer can re-attach with a fresh `start()`. */
  async stop(): Promise<void> {
    const sc = this.screencast;
    this.screencast = null;
    if (sc) await sc.stop();
  }

  /** Dispatch the human's input into the live page. A no-op when no viewer is streaming. */
  dispatchInput(event: CeremonyInputEvent): void {
    this.screencast?.dispatchInput(event);
  }

  /** The ceremony ended: stop for good. After this, `start()` never re-attaches. */
  async teardown(): Promise<void> {
    this.torndown = true;
    await this.stop();
  }
}
