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
/** How often to push a screenshot when the screencast has gone quiet. CDP screencast only fires on a
 *  repaint, so an already-loaded login page can sit silent after the first frame; the hosted canvas
 *  keeps the same fallback (`api/src/streaming/session.ts`). */
const POLL_INTERVAL_MS = parseInt(process.env.EKOA_STREAMING_POLL_INTERVAL_MS || '500', 10);
/** How long the CSS-viewport probe may take before the screencast starts unclamped anyway. A blocked
 *  probe must NEVER hold up frame production - a black canvas is worse than an unclamped one. */
const VIEWPORT_PROBE_TIMEOUT_MS = 1500;

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

/** Reject `p` if it has not settled within `ms`, so a hung CDP round-trip cannot block the caller.
 *  The timer is unref'd so it never keeps the daemon alive on its own. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    timer.unref?.();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e as Error);
      },
    );
  });
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
  /** Screenshot fallback (mirrors `api/src/streaming/session.ts`): the wall-clock of the last frame
   *  sent, and the poll timer that pushes a screenshot when the screencast has been quiet. */
  private lastFrameAt = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** The window's CSS-pixel viewport (from `Page.getLayoutMetrics`), stamped on every frame so the
   *  dashboard maps clicks into the space `Input.dispatch*` is in - not the frame's own pixels, which
   *  are 2x on a HiDPI display and differ between screencast and screenshot frames. Null until probed. */
  private cssSize: { width: number; height: number } | null = null;

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
    // A stop() that landed DURING `Page.enable` must abort before the screencast starts (BUG L3):
    // without this re-check the viewer-gone case would still send `Page.startScreencast` and leave
    // frames flowing to no one. `onFrame` already guards on `this.stopped`, so the pipeline stays
    // silent, but not starting it at all is the honest outcome.
    if (this.stopped) return;
    // CLAMP the screencast to the page's CSS-pixel viewport (D-CEREMONY-STREAM-COORDS). Chrome
    // screencasts at DEVICE resolution, so on a HiDPI window (deviceScaleFactor 2 - a Retina Mac) the
    // frame image is TWICE the CSS viewport. `Input.dispatchMouseEvent` takes CSS pixels, so a click at
    // the frame's visual position then lands at the wrong page coordinate - the human aims at "Log in"
    // and hits the link beside it. maxWidth/maxHeight = the CSS viewport collapses the frame back to
    // 1:1 with the coordinate space input is dispatched in, exactly as the hosted canvas does with
    // page.viewportSize() (api/src/streaming/session.ts). It also ~halves the bytes on a Retina display.
    const clamp = await this.cssViewport();
    this.cssSize = clamp; // stamped on every frame so the dashboard maps clicks into CSS-pixel space
    // Re-check stopped after the metrics round-trip, same honesty as the post-`Page.enable` guard.
    if (this.stopped) return;
    // everyNthFrame from FPS exactly as the hosted canvas derives it: at 15fps Chrome emits every
    // 4th compositor frame (~15/s off a 60Hz pipeline).
    const everyNthFrame = Math.max(1, Math.round(60 / Math.max(1, FPS)));
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: QUALITY,
      everyNthFrame,
      ...(clamp ? { maxWidth: clamp.width, maxHeight: clamp.height } : {}),
    });
    // Push one screenshot immediately so the viewer paints at once - a headed page that is already
    // loaded may emit no screencast frame until something repaints, leaving the canvas black - then
    // poll a screenshot whenever the screencast has gone quiet. The same safety net the hosted canvas
    // keeps (`api/src/streaming/session.ts`). Screenshots are pictures of the login page and ride the
    // exact same no-log `ceremony.frame` path as screencast frames.
    void this.pushScreenshot();
    this.startPolling();
  }

  /** Capture one screenshot over CDP and relay it up as a `ceremony.frame`. Best-effort: a busy or
   *  gone page just skips this tick. NEVER logs the image. */
  private async pushScreenshot(): Promise<void> {
    if (this.stopped) return;
    let data: string | undefined;
    try {
      const res = (await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: QUALITY })) as
        | { data?: string }
        | undefined;
      data = res?.data;
    } catch {
      return; // the screencast path still drives updates when the page is dynamic
    }
    if (this.stopped || !data) return;
    this.lastFrameAt = Date.now();
    this.sendFrame(data);
  }

  /** Relay one JPEG up as a `ceremony.frame`, stamped with the CSS-pixel viewport (when known) so the
   *  dashboard maps clicks into the coordinate space `Input.dispatch*` runs in. NEVER logs the image. */
  private sendFrame(jpegBase64: string): void {
    this.send({
      type: 'ceremony.frame',
      requestId: this.requestId,
      seq: ++this.seq,
      jpegBase64,
      ...(this.cssSize ? { cssWidth: this.cssSize.width, cssHeight: this.cssSize.height } : {}),
    });
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      if (this.stopped) return;
      // Only screenshot when the screencast has delivered nothing recently - a dynamic page keeps
      // frames flowing and needs no poll.
      if (Date.now() - this.lastFrameAt < POLL_INTERVAL_MS) return;
      void this.pushScreenshot();
    }, POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * The page's CSS-pixel layout viewport, read over CDP so the screencast can be clamped to it (the
   * coordinate fix above). Absent - a CDP session that does not answer `Page.getLayoutMetrics`, or a
   * zero/garbage viewport - leaves the screencast unclamped: correct on a 1x display, and the viewer
   * adapts to whatever frame size arrives regardless. This touches no credential-bearing material, but
   * consistent with the whole-file rule it logs nothing.
   */
  private async cssViewport(): Promise<{ width: number; height: number } | null> {
    try {
      // Bounded: a probe that never answers must not hold up `Page.startScreencast`. On timeout we
      // resolve to an unclamped screencast (correct on a 1x display; the viewer adapts regardless).
      const metrics = (await withTimeout(
        this.cdp.send('Page.getLayoutMetrics'),
        VIEWPORT_PROBE_TIMEOUT_MS,
      )) as
        | {
            cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
            layoutViewport?: { clientWidth?: number; clientHeight?: number };
          }
        | undefined;
      const vp = metrics?.cssLayoutViewport ?? metrics?.layoutViewport;
      const w = vp?.clientWidth;
      const h = vp?.clientHeight;
      if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
        return { width: Math.round(w), height: Math.round(h) };
      }
    } catch {
      /* fall through to unclamped */
    }
    return null;
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
    this.lastFrameAt = Date.now();
    this.sendFrame(frame.data);
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
    this.stopPolling();
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
  /**
   * The last state a caller asked for. `start()` sets it 'on', `stop()`/`teardown()` set it 'off'.
   *
   * It exists because `stop()` alone cannot cancel an in-flight `start()`: a viewer that connects
   * (`start()` begins, `await this.newCdp()` in flight) then immediately drops (`stop()` reads
   * `this.screencast` still null and no-ops) used to leave the start closure — which re-checked only
   * `this.torndown` — free to install and start a screencast with NO viewer, orphan frames flowing up
   * the bridge link for the rest of the ceremony (BUG L3). `stop()` now records 'off' AND awaits the
   * in-flight start, and the closure re-checks this AFTER the await and tears the just-created CDP
   * session down instead of installing it.
   */
  private desired: 'on' | 'off' = 'off';

  constructor(
    private readonly newCdp: () => Promise<BridgeCdpSession>,
    private readonly send: (frame: BridgeFrame) => boolean,
    private readonly requestId: string,
  ) {}

  /** A viewer connected: attach the screencast if it is not already up. Concurrent starts join. */
  async start(): Promise<void> {
    this.desired = 'on';
    if (this.torndown || this.screencast) return;
    if (this.starting) return this.starting;
    this.starting = (async (): Promise<void> => {
      const cdp = await this.newCdp();
      // A stop/teardown that raced the CDP attach WINS: do not install a stream nobody is waiting
      // for (BUG L3). The viewer dropped while `newCdp()` was in flight, so `desired` is now 'off' (or
      // the ceremony tore down) — drop the just-created session on the floor rather than screencasting
      // to no one. Leaving `screencast` null lets a genuinely later viewer re-attach with a fresh
      // `start()`. The seam exposes no detach, and none is needed: an un-started CDP session with no
      // `Page.startScreencast` sent produces no frames and dies with the window.
      if (this.torndown || this.desired === 'off') {
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
    this.desired = 'off';
    // Await any in-flight start so its post-`newCdp()` re-check runs before we return: otherwise a
    // stop() that lands mid-launch would return while the start closure is still about to install an
    // orphan screencast (BUG L3). The closure, seeing `desired === 'off'`, installs nothing, so once
    // it settles there is no screencast to stop.
    if (this.starting) await this.starting;
    // A viewer that RE-ATTACHED while we awaited the in-flight start (a fast close+reconnect - the
    // connect set `desired` back to 'on' and joined the same `starting` promise, which then installed
    // the screencast) must keep its stream. Without this re-read, stop() would tear down the stream the
    // reconnected viewer is now watching, leaving it black until a reload (BUG L3, second-order:
    // start-stop-start). Read through `desiredIsOn()` because the `await` above can mutate `desired`
    // and TS's flow analysis cannot see that (it narrowed it to 'off' at the top of stop()).
    // teardown() is unaffected - it gates on `torndown`, not `desired`.
    if (this.desiredIsOn()) return;
    const sc = this.screencast;
    this.screencast = null;
    if (sc) await sc.stop();
  }

  /** Whether a viewer currently wants the stream. A method (not an inline `this.desired === 'on'`)
   *  so a caller reading it AFTER an `await` gets the live value - inline, TS narrows `desired` to
   *  whatever it was assigned before the await and flags the comparison as impossible. */
  private desiredIsOn(): boolean {
    return this.desired === 'on';
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
