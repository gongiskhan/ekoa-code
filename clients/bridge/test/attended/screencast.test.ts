import { describe, it, expect, vi, afterEach } from 'vitest';
import { CeremonyScreencast } from '../../src/attended/index.js';
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
