/**
 * The Playwright stand-in every attended-ceremony test drives.
 *
 * Extracted from `ceremony.test.ts` when the Done-capture signal (D-CEREMONY-DONE) gained a second
 * suite: the daemon's frame routing has to be exercised against a REAL `runAttendedCeremony`, not a
 * mock of it, because the whole property under test is that the frame reaches the ceremony's own
 * loop and produces the ordinary push. Two copies of these fakes would let one drift into agreeing
 * with a ceremony the other no longer describes.
 */
import type { CeremonyBrowser, CeremonyContext, CeremonyPage } from '../../src/attended/index.js';
import type { BridgeCdpSession } from '../../src/browser/index.js';
import type { BridgeFrame } from '../../src/wire/index.js';

type Handlers = Record<string, Array<() => void>>;

/**
 * A fake minimal CDP session for the live-stream tests (D-CEREMONY-STREAM). Records every `send`
 * (method + params) so a test can assert `Page.startScreencast`, the acks, `Input.dispatch*` and
 * `Page.stopScreencast`, and lets a test FIRE a `Page.screencastFrame` at the registered handler.
 */
export class FakeCdp implements BridgeCdpSession {
  readonly calls: Array<{ method: string; params?: unknown }> = [];
  private frameHandler: ((payload: unknown) => void) | null = null;

  send(method: string, params?: unknown): Promise<unknown> {
    this.calls.push(params === undefined ? { method } : { method, params });
    return Promise.resolve(undefined);
  }

  on(event: string, handler: (payload: any) => void): void {
    if (event === 'Page.screencastFrame') this.frameHandler = handler;
  }

  /** Fire one screencast frame at the producer, as CDP would. */
  fireFrame(frame: { data: string; sessionId: number }): void {
    this.frameHandler?.(frame);
  }

  /** Calls to one CDP method, in order. */
  callsTo(method: string): Array<{ method: string; params?: unknown }> {
    return this.calls.filter((c) => c.method === method);
  }
}

export class FakeBrowser implements CeremonyBrowser {
  readonly handlers: Handlers = {};
  closed = false;
  constructor(readonly context: FakeContext) {}
  newContext(): Promise<CeremonyContext> {
    return Promise.resolve(this.context);
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
  on(event: 'disconnected', handler: () => void): void {
    (this.handlers[event] ??= []).push(handler);
  }
}

export class FakeContext implements CeremonyContext {
  readonly handlers: Handlers = {};
  /** Present ONLY when a fake CDP was supplied — so a context without one never streams, exactly as
   *  the real seam behaves for a launcher that produced no CDP. */
  newCDPSession?: () => Promise<BridgeCdpSession>;
  constructor(
    readonly page: FakePage,
    private state: unknown,
    readonly cdp?: FakeCdp,
  ) {
    if (cdp) this.newCDPSession = (): Promise<BridgeCdpSession> => Promise.resolve(cdp);
  }
  setState(next: unknown): void {
    this.state = next;
  }
  newPage(): Promise<CeremonyPage> {
    return Promise.resolve(this.page);
  }
  storageState(): Promise<unknown> {
    return Promise.resolve(this.state);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  on(event: 'close', handler: () => void): void {
    (this.handlers[event] ??= []).push(handler);
  }
}

export class FakePage implements CeremonyPage {
  readonly handlers: Handlers = {};
  gotoCalls: string[] = [];
  constructor(private current: string) {}
  setUrl(next: string): void {
    this.current = next;
  }
  goto(url: string): Promise<unknown> {
    this.gotoCalls.push(url);
    return Promise.resolve(null);
  }
  url(): string {
    return this.current;
  }
  on(event: 'close', handler: () => void): void {
    (this.handlers[event] ??= []).push(handler);
  }
  fire(event: string): void {
    for (const h of this.handlers[event] ?? []) h();
  }
}

export const LOGGED_IN = { cookies: [{ name: 'SESSION', value: 'x', domain: 'portal.tribunais.org.pt' }], origins: [] };
export const EMPTY = { cookies: [], origins: [] };

export function harness(opts: { url?: string; state?: unknown; cdp?: FakeCdp } = {}) {
  const page = new FakePage(opts.url ?? 'https://portal.tribunais.org.pt/inicio');
  const context = new FakeContext(page, opts.state ?? LOGGED_IN, opts.cdp);
  const browser = new FakeBrowser(context);
  const sent: BridgeFrame[] = [];
  const logs: string[] = [];
  return {
    page,
    context,
    browser,
    sent,
    logs,
    deps: {
      send: (f: BridgeFrame) => {
        sent.push(f);
        return true;
      },
      log: (m: string) => logs.push(m),
      launchBrowser: () => Promise.resolve(browser as CeremonyBrowser),
    },
  };
}

/** Close the window on the next tick so the snapshot loop runs at least once first. */
export function closeSoon(h: ReturnType<typeof harness>, afterMs = 5): void {
  setTimeout(() => h.page.fire('close'), afterMs);
}
