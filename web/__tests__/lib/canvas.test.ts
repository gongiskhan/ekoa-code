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
