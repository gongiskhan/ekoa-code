import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openCanvas } from '@/lib/api/canvas';

/**
 * The media-channel wire is TEXT JSON in BOTH directions (`api/src/streaming/protocol.ts`). A B17
 * port regression had the client waiting for binary Blobs and dropping every text frame, and sending
 * input in a vocabulary the server never matched — so the live canvas was silently 100% dead. These
 * pin the translation both ways so that cannot regress again.
 */

interface SentMessage {
  type: string;
  [k: string]: unknown;
}

class MockWebSocket {
  static OPEN = 1;
  static last: MockWebSocket | null = null;
  readyState = MockWebSocket.OPEN;
  sent: SentMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    MockWebSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000): void {
    this.onclose?.({ code });
  }
  serverSend(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const OPTS = { wsUrl: 'wss://x/api/v1/automation-stream/t1', token: 'tok', viewport: { width: 1280, height: 800 } };

beforeEach(() => {
  MockWebSocket.last = null;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
});
afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
});

describe('the live canvas speaks the server media-channel wire', () => {
  it('decodes a text `frame` message to a data URL and ACKs it by seq', () => {
    const canvas = openCanvas(OPTS);
    const ws = MockWebSocket.last!;
    const frames: string[] = [];
    canvas.onFrame((f) => frames.push(f));

    ws.serverSend({ type: 'frame', seq: 7, jpegBase64: 'QUJD' });

    expect(frames).toEqual(['data:image/jpeg;base64,QUJD']);
    // Acking is load-bearing: the server bounds unacked frames to 3 and stops forwarding past that.
    expect(ws.sent).toContainEqual({ type: 'frame_ack', seq: 7 });
  });

  it('ignores a binary message rather than crashing (the channel is text-only)', () => {
    const canvas = openCanvas(OPTS);
    const ws = MockWebSocket.last!;
    let count = 0;
    canvas.onFrame(() => (count += 1));
    ws.onmessage?.({ data: new ArrayBuffer(8) });
    expect(count).toBe(0);
  });

  it('applies a `viewport` message', () => {
    const canvas = openCanvas(OPTS);
    const ws = MockWebSocket.last!;
    let vp: { width: number; height: number } | null = null;
    canvas.onViewport((v) => (vp = v));
    ws.serverSend({ type: 'viewport', width: 640, height: 480 });
    expect(vp).toEqual({ width: 640, height: 480 });
    expect(canvas.viewport).toEqual({ width: 640, height: 480 });
  });

  it('translates a mouse-down to the server `mouse` shape with a named button', () => {
    const canvas = openCanvas(OPTS);
    const ws = MockWebSocket.last!;
    canvas.sendInput({ type: 'mousedown', x: 12, y: 34, button: 2 });
    expect(ws.sent).toContainEqual({ type: 'mouse', action: 'down', x: 12, y: 34, button: 'right' });
  });

  it('translates a wheel and a move to the `mouse` action vocabulary', () => {
    const canvas = openCanvas(OPTS);
    const ws = MockWebSocket.last!;
    canvas.sendInput({ type: 'mousemove', x: 1, y: 2 });
    canvas.sendInput({ type: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: 40 });
    expect(ws.sent).toContainEqual({ type: 'mouse', action: 'move', x: 1, y: 2, button: 'none' });
    expect(ws.sent).toContainEqual({ type: 'mouse', action: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: 40 });
  });

  it('translates a key event and maps the modifier NAMES to the flag object', () => {
    const canvas = openCanvas(OPTS);
    const ws = MockWebSocket.last!;
    canvas.sendInput({ type: 'keydown', key: 'a', code: 'KeyA', modifiers: ['Meta', 'Shift'] });
    expect(ws.sent).toContainEqual({
      type: 'key',
      action: 'down',
      key: 'a',
      code: 'KeyA',
      modifiers: { meta: true, shift: true },
    });
  });

  it('does not put `click`/`text` on the wire — they have no media-channel representation', () => {
    const canvas = openCanvas(OPTS);
    const ws = MockWebSocket.last!;
    canvas.sendInput({ type: 'click', x: 1, y: 1 });
    canvas.sendInput({ type: 'text', text: 'hello' });
    expect(ws.sent).toEqual([]);
  });
});

/**
 * The server mints a RELATIVE wsUrl (`/api/v1/ceremony-stream/<id>`) because prod is same-origin. In
 * split-origin dev (page on `:3000`, API on `:4111`) a relative WebSocket URL would dial the PAGE
 * origin and never reach the ceremony-stream handler — the canvas hangs at `connecting`. These pin
 * the resolution to the API origin so that cannot regress (the live-verification bug, 2026-08-27).
 */
describe('the canvas resolves the wsUrl to the API origin, not the page origin', () => {
  const prevEnv = process.env.NEXT_PUBLIC_API_URL;
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = prevEnv;
  });

  it('resolves a relative path against the API port, not the page port', () => {
    // Page origin is jsdom's default (`http://localhost:3000`); API env points at :4111. The socket
    // must dial :4111 (where the WS handler lives), NOT the :3000 the page is served from.
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4111';
    openCanvas({ ...OPTS, wsUrl: '/api/v1/ceremony-stream/r1' });
    const url = MockWebSocket.last!.url;
    expect(url).toMatch(/^ws:\/\/localhost:4111\/api\/v1\/ceremony-stream\/r1\?token=/);
    // A relative URL that leaked through unresolved would start with `/` — never construct one.
    expect(url.startsWith('/')).toBe(false);
  });

  it('passes an already-absolute ws(s):// URL through unchanged', () => {
    openCanvas({ ...OPTS, wsUrl: 'wss://app.ekoa.io/api/v1/ceremony-stream/r2' });
    expect(MockWebSocket.last!.url).toMatch(
      /^wss:\/\/app\.ekoa\.io\/api\/v1\/ceremony-stream\/r2\?token=/,
    );
  });
});
