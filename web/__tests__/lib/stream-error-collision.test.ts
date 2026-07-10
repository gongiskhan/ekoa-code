/**
 * SseStream vs the DOM `error` event (found by the thinking-channel live proof, 2026-07-10).
 * EventSource fires a DOM `error` Event (no `data`) on every connection blip; a consumer
 * subscribed to the union's `error` member registers a DOM listener of that same name, so a
 * transient disconnect used to dispatch a fake `{}` error into the app — falsely settling a
 * healthy mid-stream chat run with "Algo correu mal". Every ch03 §3.6 named event carries a
 * `data:` payload, so the dispatcher must drop payload-less named events.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/api/token', () => ({
  getToken: () => 'test-token',
  subscribe: () => () => {},
}));
vi.mock('@/lib/api/base-url', () => ({
  resolveBaseUrl: () => 'http://api.test',
}));

type Listener = (event: Event | MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 0;
  onopen: Listener | null = null;
  onerror: Listener | null = null;
  onmessage: Listener | null = null;
  listeners = new Map<string, Set<Listener>>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emitNamed(type: string, data?: string) {
    // Mirrors the DOM: a server named event is a MessageEvent WITH data; the connection-error
    // artifact is a plain Event of type 'error' with NO data property.
    const event = (data === undefined ? new Event(type) : new MessageEvent(type, { data })) as MessageEvent;
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

async function openStream() {
  const { openChatRunStream } = await import('@/lib/api/stream');
  return openChatRunStream('run-1');
}

describe('SseStream named-event dispatch', () => {
  it('drops the payload-less DOM error event instead of dispatching a fake union error', async () => {
    const stream = await openStream();
    const onError = vi.fn();
    stream.on('error', onError);
    const es = FakeEventSource.instances.at(-1)!;

    es.emitNamed('error'); // DOM connection-error artifact: no data
    expect(onError).not.toHaveBeenCalled();

    // A REAL server error event (has a data payload) still reaches the handler.
    es.emitNamed('error', JSON.stringify({ type: 'error', code: 'TIMEOUT', message: 'x' }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toMatchObject({ code: 'TIMEOUT' });
    stream.close();
  });

  it('dispatches payload-carrying named events (thinking_chunk) to their handlers', async () => {
    const stream = await openStream();
    const onThinking = vi.fn();
    stream.on('thinking_chunk', onThinking);
    const es = FakeEventSource.instances.at(-1)!;

    es.emitNamed('thinking_chunk', JSON.stringify({ type: 'thinking_chunk', text: 'a pensar' }));
    expect(onThinking).toHaveBeenCalledTimes(1);
    expect(onThinking.mock.calls[0]![0]).toMatchObject({ text: 'a pensar' });
    stream.close();
  });
});
