import { describe, it, expect, vi, afterEach } from 'vitest';
import { CeremonyScreencast, CeremonyStreamController } from '../../src/attended/index.js';
import type { BridgeCdpSession } from '../../src/browser/index.js';
import type { BridgeFrame, CeremonyInputEvent } from '../../src/wire/index.js';
import { FakeCdp } from './fake-browser.js';

/**
 * The DAEMON PRODUCER of the attended-ceremony live stream (D-CEREMONY-STREAM). Playwright is
 * substituted by a fake CDP session, so these assert the PRODUCER's behaviour — what CDP calls it
 * makes, what it relays up, how it maps input — and, above all, that it NEVER logs a keystroke or a
 * frame (both are credential-bearing: a key is a password character, a frame is the login page).
 */

const REQUEST_ID = 'ceremony-stream-req-1';

function make(): { cdp: FakeCdp; sent: BridgeFrame[]; sc: CeremonyScreencast } {
  const cdp = new FakeCdp();
  const sent: BridgeFrame[] = [];
  const sc = new CeremonyScreencast(
    cdp,
    (f) => {
      sent.push(f);
      return true;
    },
    REQUEST_ID,
  );
  return { cdp, sent, sc };
}

const frames = (sent: BridgeFrame[]): Array<Extract<BridgeFrame, { type: 'ceremony.frame' }>> =>
  sent.filter((f): f is Extract<BridgeFrame, { type: 'ceremony.frame' }> => f.type === 'ceremony.frame');

describe('CeremonyScreencast — start, relay, ack', () => {
  it('enables Page and starts the screencast as jpeg at the configured quality/cadence', async () => {
    const { cdp, sc } = make();
    await sc.start();

    const methods = cdp.calls.map((c) => c.method);
    expect(methods).toContain('Page.enable');
    const start = cdp.callsTo('Page.startScreencast');
    expect(start).toHaveLength(1);
    expect(start[0]!.params).toMatchObject({ format: 'jpeg', quality: 70, everyNthFrame: 4 }); // 60/15
    // Page must be enabled BEFORE the screencast starts on this separate CDP channel.
    expect(methods.indexOf('Page.enable')).toBeLessThan(methods.indexOf('Page.startScreencast'));
  });

  it('clamps the screencast to the page CSS viewport so HiDPI frames map 1:1 to input coordinates', async () => {
    // Chrome screencasts at DEVICE resolution; on a Retina window (deviceScaleFactor 2) an unclamped
    // frame is 2x the CSS viewport, and a click on it lands at the wrong page coordinate when
    // dispatched via Input.dispatchMouseEvent (CSS pixels). Given the real CSS viewport, the producer
    // must pass it as maxWidth/maxHeight so Chrome scales the frame back to 1:1.
    const calls: Array<{ method: string; params?: unknown }> = [];
    const cdp: BridgeCdpSession = {
      send(method: string, params?: unknown): Promise<unknown> {
        calls.push({ method, params });
        if (method === 'Page.getLayoutMetrics') {
          return Promise.resolve({ cssLayoutViewport: { clientWidth: 1440, clientHeight: 782 } });
        }
        return Promise.resolve(undefined);
      },
      on(): void {},
    };
    const sc = new CeremonyScreencast(cdp, () => true, REQUEST_ID);
    await sc.start();

    const start = calls.filter((c) => c.method === 'Page.startScreencast');
    expect(start).toHaveLength(1);
    expect(start[0]!.params).toMatchObject({ format: 'jpeg', maxWidth: 1440, maxHeight: 782 });
  });

  it('stamps every frame with the CSS viewport so the dashboard maps clicks into CSS-pixel space', async () => {
    // The frame carries the window's CSS viewport; the dashboard maps clicks into THAT space, not the
    // frame's own (HiDPI-scaled, source-varying) pixels. Both a screencast frame and the screenshot
    // fallback must carry it.
    const sent: BridgeFrame[] = [];
    let frameHandler: ((p: unknown) => void) | null = null;
    const cdp: BridgeCdpSession = {
      send(method: string): Promise<unknown> {
        if (method === 'Page.getLayoutMetrics') {
          return Promise.resolve({ cssLayoutViewport: { clientWidth: 1440, clientHeight: 782 } });
        }
        if (method === 'Page.captureScreenshot') return Promise.resolve({ data: 'SHOT' });
        return Promise.resolve(undefined);
      },
      on(event: string, handler: (p: unknown) => void): void {
        if (event === 'Page.screencastFrame') frameHandler = handler;
      },
    };
    const sc = new CeremonyScreencast(cdp, (f) => (sent.push(f), true), REQUEST_ID);
    await sc.start();
    frameHandler!({ data: 'SCREENCAST_JPEG', sessionId: 1 });
    await sc.stop();

    const up = frames(sent);
    expect(up.length).toBeGreaterThanOrEqual(1);
    // Both the immediate screenshot and the screencast frame carry the CSS viewport.
    for (const f of up) expect(f).toMatchObject({ cssWidth: 1440, cssHeight: 782 });
  });

  it('starts UNCLAMPED when the CSS viewport is unavailable (1x display / a CDP that does not answer)', async () => {
    // FakeCdp returns undefined for Page.getLayoutMetrics, so no maxWidth/maxHeight is sent — correct
    // on a 1x display, and the viewer adapts to whatever frame size arrives.
    const { cdp, sc } = make();
    await sc.start();
    const start = cdp.callsTo('Page.startScreencast')[0]!.params as Record<string, unknown>;
    expect(start).not.toHaveProperty('maxWidth');
    expect(start).not.toHaveProperty('maxHeight');
  });

  it('pushes an immediate screenshot frame so an already-loaded (static) page is never left black', async () => {
    // CDP screencast only fires on a repaint, so a headed page that is already loaded can emit no
    // Page.screencastFrame after startScreencast. The producer must push a screenshot at once (and
    // poll one when quiet) - the same fallback the hosted canvas keeps - or the viewer stays black.
    const sent: BridgeFrame[] = [];
    const cdp: BridgeCdpSession = {
      send(method: string): Promise<unknown> {
        if (method === 'Page.captureScreenshot') return Promise.resolve({ data: 'SCREENSHOT_JPEG' });
        return Promise.resolve(undefined);
      },
      on(): void {},
    };
    const sc = new CeremonyScreencast(cdp, (f) => (sent.push(f), true), REQUEST_ID);
    await sc.start();
    await sc.stop(); // stop clears the poll timer so the test leaves nothing running

    // No Page.screencastFrame was ever fired, yet a frame reached the viewer - the immediate shot.
    const up = frames(sent);
    expect(up.length).toBeGreaterThanOrEqual(1);
    expect(up[0]).toMatchObject({ type: 'ceremony.frame', jpegBase64: 'SCREENSHOT_JPEG' });
  });

  it('relays a fired frame up as ceremony.frame with the base64, and acks it back to Chrome', async () => {
    const { cdp, sent, sc } = make();
    await sc.start();

    cdp.fireFrame({ data: 'BASE64_JPEG_ONE', sessionId: 11 });

    const up = frames(sent);
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ type: 'ceremony.frame', requestId: REQUEST_ID, seq: 1, jpegBase64: 'BASE64_JPEG_ONE' });
    // The ack keeps Chrome producing; it echoes the frame's sessionId.
    const acks = cdp.callsTo('Page.screencastFrameAck');
    expect(acks).toHaveLength(1);
    expect(acks[0]!.params).toEqual({ sessionId: 11 });
  });

  it('relays EVERY frame with an incrementing seq — there is no viewer-side in-flight cap', async () => {
    // The corrected rate-control model: the daemon acks Chrome and relays each frame; Cortex, not
    // the daemon, drops frames when the dashboard socket is slow. A burst of frames must therefore
    // all travel (Chrome's own ack-gating + everyNthFrame is the only throttle here).
    const { cdp, sent, sc } = make();
    await sc.start();

    for (let i = 0; i < 6; i++) cdp.fireFrame({ data: `f${i}`, sessionId: i });

    const up = frames(sent);
    expect(up).toHaveLength(6); // NOT capped at 3
    expect(up.map((f) => f.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cdp.callsTo('Page.screencastFrameAck')).toHaveLength(6); // every frame acked
  });

  it('stop sends Page.stopScreencast and stops relaying', async () => {
    const { cdp, sent, sc } = make();
    await sc.start();
    await sc.stop();

    expect(cdp.callsTo('Page.stopScreencast')).toHaveLength(1);
    // A frame that arrives after stop is dropped, not relayed.
    cdp.fireFrame({ data: 'LATE', sessionId: 99 });
    expect(frames(sent)).toHaveLength(0);
  });
});

describe('CeremonyScreencast — input dispatch maps to CDP', () => {
  it('a mouse-down dispatches Input.dispatchMouseEvent{type:mousePressed,button:left}', async () => {
    const { cdp, sc } = make();
    await sc.start();

    const down: CeremonyInputEvent = { type: 'mouse', x: 120, y: 240, action: 'down', button: 'left' };
    sc.dispatchInput(down);

    const calls = cdp.callsTo('Input.dispatchMouseEvent');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toMatchObject({ type: 'mousePressed', x: 120, y: 240, button: 'left', clickCount: 1 });
  });

  it('maps the remaining mouse actions and the wheel deltas', async () => {
    const { cdp, sc } = make();
    await sc.start();
    sc.dispatchInput({ type: 'mouse', x: 1, y: 2, action: 'move' });
    sc.dispatchInput({ type: 'mouse', x: 3, y: 4, action: 'up', button: 'left' });
    sc.dispatchInput({ type: 'mouse', x: 5, y: 6, action: 'wheel', deltaX: 0, deltaY: -120 });

    const calls = cdp.callsTo('Input.dispatchMouseEvent');
    expect(calls.map((c) => (c.params as { type: string }).type)).toEqual(['mouseMoved', 'mouseReleased', 'mouseWheel']);
    expect(calls[2]!.params).toMatchObject({ type: 'mouseWheel', deltaX: 0, deltaY: -120 });
  });

  it('a key-down with {meta:true} dispatches Input.dispatchKeyEvent{type:keyDown,modifiers:4}', async () => {
    const { cdp, sc } = make();
    await sc.start();

    const key: CeremonyInputEvent = { type: 'key', code: 'KeyA', key: 'a', action: 'down', modifiers: { meta: true } };
    sc.dispatchInput(key);

    const calls = cdp.callsTo('Input.dispatchKeyEvent');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toMatchObject({ type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, text: 'a' });
  });

  it('combines modifier bits alt=1 ctrl=2 meta=4 shift=8', async () => {
    const { cdp, sc } = make();
    await sc.start();
    sc.dispatchInput({
      type: 'key',
      code: 'Enter',
      key: 'Enter',
      action: 'up',
      modifiers: { alt: true, ctrl: true, meta: true, shift: true },
    });
    const calls = cdp.callsTo('Input.dispatchKeyEvent');
    // Enter is not a single printable char, so no `text`; action 'up' -> keyUp; all four bits -> 15.
    expect(calls[0]!.params).toMatchObject({ type: 'keyUp', modifiers: 15 });
    expect((calls[0]!.params as { text?: string }).text).toBeUndefined();
  });
});

describe('CeremonyScreencast — credential privacy (the non-negotiable)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('NEVER logs a keystroke or a frame anywhere in the producer', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const SECRET_PASSWORD_CHAR = 'PASSWORDCHAR_SECRET';
    const SECRET_KEYCODE = 'KeyS_SECRET';
    const SECRET_FRAME = 'BASE64_LOGIN_PAGE_PIXELS_SECRET';

    const { cdp, sc } = make();
    await sc.start();
    cdp.fireFrame({ data: SECRET_FRAME, sessionId: 7 });
    sc.dispatchInput({ type: 'key', code: SECRET_KEYCODE, key: SECRET_PASSWORD_CHAR, action: 'down' });
    sc.dispatchInput({ type: 'mouse', x: 1, y: 1, action: 'move' });
    await sc.stop();

    // No sensitive material in any log line...
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        const line = call.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        expect(line).not.toContain(SECRET_FRAME);
        expect(line).not.toContain(SECRET_KEYCODE);
        expect(line).not.toContain(SECRET_PASSWORD_CHAR);
      }
    }
    // ...and the strongest form: the producer logs NOTHING at all.
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('CeremonyStreamController — a stop() that races an in-flight start() (BUG L3)', () => {
  it('leaves NO screencast running when the viewer drops while newCdp() is still in flight', async () => {
    const cdp = new FakeCdp();
    const sent: BridgeFrame[] = [];
    // A DEFERRED newCdp so a stop() can land while start() is suspended on the CDP attach — the exact
    // race the bug needs: viewer connects (start begins, `await newCdp()` in flight) then immediately
    // drops (stop reads screencast still null and no-ops).
    let resolveCdp!: (c: BridgeCdpSession) => void;
    const newCdp = (): Promise<BridgeCdpSession> => new Promise<BridgeCdpSession>((r) => (resolveCdp = r));
    const ctrl = new CeremonyStreamController(
      newCdp,
      (f) => {
        sent.push(f);
        return true;
      },
      REQUEST_ID,
    );

    const startP = ctrl.start(); // suspends on `await newCdp()`
    const stopP = ctrl.stop(); // the viewer drops before the CDP session resolves
    resolveCdp(cdp); // the CDP attach completes AFTER the drop
    await Promise.all([startP, stopP]);

    // Before the fix the start closure re-checked only `this.torndown` (false) and installed a
    // screencast with NO viewer — orphan frames at 15fps up the bridge link for the rest of the
    // ceremony (up to 9 min). The fix drops the just-created session: nothing is ever started.
    expect(cdp.callsTo('Page.startScreencast')).toHaveLength(0);
    // And no frame handler was installed, so a frame that fires anyway is relayed by nobody.
    cdp.fireFrame({ data: 'ORPHAN_FRAME', sessionId: 1 });
    expect(frames(sent)).toHaveLength(0);
  });

  it('a normal connect (no drop) still installs and streams', async () => {
    // The guard must not break the ordinary path: a start() with no racing stop attaches the stream.
    const cdp = new FakeCdp();
    const sent: BridgeFrame[] = [];
    const ctrl = new CeremonyStreamController(
      () => Promise.resolve(cdp as BridgeCdpSession),
      (f) => {
        sent.push(f);
        return true;
      },
      REQUEST_ID,
    );

    await ctrl.start();
    expect(cdp.callsTo('Page.startScreencast')).toHaveLength(1);
    cdp.fireFrame({ data: 'LIVE_FRAME', sessionId: 2 });
    expect(frames(sent)).toHaveLength(1);
  });

  it('a viewer that RE-ATTACHES during the in-flight start KEEPS its stream (start-stop-start, L3 2nd-order)', async () => {
    // A fast close+reconnect (reload) while the first start() is still awaiting newCdp(): the reconnect
    // set `desired` back to 'on' and joined the same in-flight start. Before the second-order fix,
    // stop() resumed after its await and tore down the screencast the reconnected viewer was now
    // watching (black canvas until reload). stop() now re-reads `desired` after the await and bails.
    const cdp = new FakeCdp();
    const sent: BridgeFrame[] = [];
    let resolveCdp!: (c: BridgeCdpSession) => void;
    const newCdp = (): Promise<BridgeCdpSession> => new Promise<BridgeCdpSession>((r) => (resolveCdp = r));
    const ctrl = new CeremonyStreamController(
      newCdp,
      (f) => {
        sent.push(f);
        return true;
      },
      REQUEST_ID,
    );

    const start1 = ctrl.start(); // suspends on newCdp()
    const stop1 = ctrl.stop(); // viewer drops (desired='off', awaits the in-flight start)
    const start2 = ctrl.start(); // viewer RECONNECTS before the CDP resolves (desired='on', joins start1)
    resolveCdp(cdp);
    await Promise.all([start1, stop1, start2]);

    expect(cdp.callsTo('Page.startScreencast')).toHaveLength(1); // installed for the reconnected viewer
    cdp.fireFrame({ data: 'RECONNECTED_FRAME', sessionId: 3 });
    expect(frames(sent)).toHaveLength(1); // ...and it is still streaming, not torn down by the stop
  });
});

describe('CeremonyScreencast — a stop() during Page.enable (BUG L3, second half)', () => {
  it('re-checks stopped after Page.enable and never sends Page.startScreencast', async () => {
    // A CDP whose `Page.enable` is deferred, so a stop() can slip in between enable and the screencast
    // start. Without the re-check the producer would still send `Page.startScreencast` and leave
    // frames flowing to a viewer that has gone.
    const calls: string[] = [];
    let resolveEnable!: () => void;
    const cdp: BridgeCdpSession = {
      send(method: string): Promise<unknown> {
        calls.push(method);
        if (method === 'Page.enable') return new Promise<void>((r) => (resolveEnable = r));
        return Promise.resolve(undefined);
      },
      on(): void {
        /* no frame handler needed for this test */
      },
    };
    const sent: BridgeFrame[] = [];
    const sc = new CeremonyScreencast(
      cdp,
      (f) => {
        sent.push(f);
        return true;
      },
      REQUEST_ID,
    );

    const startP = sc.start(); // suspends on Page.enable
    await sc.stop(); // the viewer drops mid-enable
    resolveEnable(); // Page.enable completes AFTER the stop
    await startP;

    expect(calls).not.toContain('Page.startScreencast');
  });
});
