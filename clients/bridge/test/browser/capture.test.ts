/**
 * The machine-side network recorder (slice P2.2).
 *
 * The property under test is the one the whole discovery spine rests on: a header VALUE never
 * leaves this module, in either direction, while the header NAME always does. Everything else here
 * (bounds, attribution, the live-value map an injected replay reads) exists to serve that.
 */
import { describe, it, expect } from 'vitest';
import {
  NetworkRecorder,
  MAX_BUFFERED_EXCHANGES,
  MAX_CAPTURE_BODY_CHARS,
  type CapturePage,
  type CaptureRequest,
  type CaptureResponse,
} from '../../src/browser/capture.js';

/** A fake page that hands the recorder responses on demand - no browser anywhere in this file. */
function fakePage(): CapturePage & { emit(response: CaptureResponse): void; listeners: number } {
  const handlers: Array<(r: CaptureResponse) => void> = [];
  return {
    on: (_event, handler) => { handlers.push(handler); },
    off: (_event, handler) => {
      const i = handlers.indexOf(handler);
      if (i >= 0) handlers.splice(i, 1);
    },
    emit: (response) => { for (const h of [...handlers]) h(response); },
    get listeners() { return handlers.length; },
  };
}

function exchange(opts: {
  url?: string;
  method?: string;
  resourceType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  status?: number;
  body?: string;
  postData?: string | null;
}): CaptureResponse {
  const request: CaptureRequest = {
    url: () => opts.url ?? 'https://portal.example/api/cases?page=2',
    method: () => opts.method ?? 'GET',
    resourceType: () => opts.resourceType ?? 'xhr',
    headers: () => opts.requestHeaders ?? { 'x-csrf-token': 'CSRF-abc123', cookie: 'sid=deadbeef', accept: 'application/json' },
    postData: () => opts.postData ?? null,
  };
  return {
    url: () => request.url(),
    status: () => opts.status ?? 200,
    headers: () => opts.responseHeaders ?? { 'content-type': 'application/json; charset=utf-8' },
    request: () => request,
    text: async () => opts.body ?? '{"items":[]}',
  };
}

/** The recorder completes a record asynchronously (it awaits the body). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('NetworkRecorder - names travel, values do not', () => {
  it('keeps request and response header NAMES and carries no value anywhere in the frame', async () => {
    const recorder = new NetworkRecorder();
    const page = fakePage();
    recorder.attach(page);
    page.emit(exchange({}));
    await settle();

    const [captured] = recorder.drain();
    expect(captured).toBeDefined();
    expect(captured!.requestHeaderNames).toEqual(['accept', 'cookie', 'x-csrf-token']);
    expect(captured!.responseHeaderNames).toEqual(['content-type']);

    // THE PROPERTY: serialise the WHOLE frame and prove neither live value survives anywhere in it,
    // not merely that the fields we thought of are clean.
    const serialised = JSON.stringify(captured);
    expect(serialised).not.toContain('CSRF-abc123');
    expect(serialised).not.toContain('sid=deadbeef');
    expect(serialised).not.toContain('deadbeef');
  });

  it('lower-cases and sorts names, and drops a key that is not a header name', async () => {
    const recorder = new NetworkRecorder();
    const page = fakePage();
    recorder.attach(page);
    page.emit(exchange({ requestHeaders: { 'X-Csrf-Token': 'v', ':authority': 'portal.example', Accept: 'application/json' } }));
    await settle();

    const [captured] = recorder.drain();
    // The HTTP/2 pseudo-header is dropped rather than refused: it is neither a forwardable name nor
    // a value, and refusing would make an ordinary capture unusable.
    expect(captured!.requestHeaderNames).toEqual(['accept', 'x-csrf-token']);
  });
});

describe('NetworkRecorder - the live header map an injected replay reads', () => {
  it('answers the CURRENT value for a name, scoped to the origin it was seen on', async () => {
    const recorder = new NetworkRecorder();
    const page = fakePage();
    recorder.attach(page);
    page.emit(exchange({ url: 'https://portal.example/api/a', requestHeaders: { 'x-csrf-token': 'first' } }));
    await settle();
    page.emit(exchange({ url: 'https://portal.example/api/b', requestHeaders: { 'x-csrf-token': 'second' } }));
    await settle();
    page.emit(exchange({ url: 'https://other.example/api/c', requestHeaders: { 'x-csrf-token': 'foreign' } }));
    await settle();

    expect(recorder.headerValuesFor('https://portal.example', ['x-csrf-token'])).toEqual({ 'x-csrf-token': 'second' });
    expect(recorder.headerValuesFor('https://other.example', ['x-csrf-token'])).toEqual({ 'x-csrf-token': 'foreign' });
    // A name never seen answers nothing, so the replay sends the request without it rather than
    // inventing one.
    expect(recorder.headerValuesFor('https://portal.example', ['x-nope'])).toEqual({});
    // An origin never seen answers nothing at all - values do not leak across origins.
    expect(recorder.headerValuesFor('https://third.example', ['x-csrf-token'])).toEqual({});
  });

  it('FORGETS every value on detach - the buffer cannot outlive the authenticated jar', async () => {
    const recorder = new NetworkRecorder();
    const page = fakePage();
    recorder.attach(page);
    page.emit(exchange({ requestHeaders: { 'x-csrf-token': 'live' } }));
    await settle();
    expect(recorder.headerValuesFor('https://portal.example', ['x-csrf-token'])).toEqual({ 'x-csrf-token': 'live' });

    recorder.detach();
    expect(recorder.headerValuesFor('https://portal.example', ['x-csrf-token'])).toEqual({});
    expect(page.listeners).toBe(0);
  });
});

describe('NetworkRecorder - what it records and what it bounds', () => {
  it('records script-issued and document exchanges and ignores the rest of the page load', async () => {
    const recorder = new NetworkRecorder();
    const page = fakePage();
    recorder.attach(page);
    for (const resourceType of ['xhr', 'fetch', 'document', 'image', 'stylesheet', 'font', 'script']) {
      page.emit(exchange({ resourceType }));
      await settle();
    }
    expect(recorder.drain().map((c) => c.resourceType)).toEqual(['xhr', 'fetch', 'document']);
  });

  it('passes bodies through the injected redaction leg BEFORE bounding them', async () => {
    const recorder = new NetworkRecorder({ redactBody: (t) => t.split('TOP-SECRET').join('[REDACTED:s1]') });
    const page = fakePage();
    recorder.attach(page);
    page.emit(exchange({ body: '{"token":"TOP-SECRET"}' }));
    await settle();

    const [captured] = recorder.drain();
    expect(captured!.responseBody).toBe('{"token":"[REDACTED:s1]"}');
  });

  it('truncates an oversized body and SAYS SO rather than handing a learner a silent prefix', async () => {
    const recorder = new NetworkRecorder();
    const page = fakePage();
    recorder.attach(page);
    page.emit(exchange({ body: 'x'.repeat(MAX_CAPTURE_BODY_CHARS + 500) }));
    await settle();

    const [captured] = recorder.drain();
    expect(captured!.responseBody!.length).toBe(MAX_CAPTURE_BODY_CHARS);
    expect(captured!.truncated).toBe(true);
  });

  it('drops the OLDEST exchange past the buffer ceiling rather than growing without bound', async () => {
    const recorder = new NetworkRecorder();
    const page = fakePage();
    recorder.attach(page);
    for (let i = 0; i < MAX_BUFFERED_EXCHANGES + 5; i += 1) {
      page.emit(exchange({ url: `https://portal.example/api/${i}` }));
    }
    await settle();

    const drained = recorder.drain();
    expect(drained.length).toBe(MAX_BUFFERED_EXCHANGES);
    // The first five are gone; the newest survives. A discovery pass drives toward a goal, so the
    // calls nearest the outcome are the ones that matter.
    expect(drained[0]!.url).toContain('/api/5');
  });

  it('drains EXACTLY once - an exchange belongs to one observation frame', async () => {
    const recorder = new NetworkRecorder();
    const page = fakePage();
    recorder.attach(page);
    page.emit(exchange({}));
    await settle();

    expect(recorder.drain()).toHaveLength(1);
    expect(recorder.drain()).toHaveLength(0);
  });

  it('re-attaching to the SAME page does not double-record', async () => {
    const recorder = new NetworkRecorder();
    const page = fakePage();
    recorder.attach(page);
    recorder.attach(page);
    expect(page.listeners).toBe(1);
    page.emit(exchange({}));
    await settle();
    expect(recorder.drain()).toHaveLength(1);
  });

  it('re-attaching to a NEW page follows the navigation instead of recording nothing', async () => {
    const recorder = new NetworkRecorder();
    const first = fakePage();
    const second = fakePage();
    recorder.attach(first);
    recorder.attach(second);
    expect(first.listeners).toBe(0);
    second.emit(exchange({}));
    await settle();
    expect(recorder.drain()).toHaveLength(1);
  });

  it('survives a body read that rejects - a lost body is not a lost exchange', async () => {
    const recorder = new NetworkRecorder();
    const page = fakePage();
    recorder.attach(page);
    const broken = exchange({});
    broken.text = async (): Promise<string> => { throw new Error('body already consumed'); };
    page.emit(broken);
    await settle();

    const [captured] = recorder.drain();
    expect(captured).toBeDefined();
    expect(captured!.responseBody).toBeUndefined();
    expect(captured!.requestHeaderNames.length).toBeGreaterThan(0);
  });
});
