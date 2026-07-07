/**
 * streaming/cdp.ts — thin Chrome DevTools Protocol wrappers over a Playwright CDP session
 * (B17 port). Screencast frames down (JPEG), Input.dispatch* up. Playwright types only.
 */
import type { CDPSession, Page } from 'playwright';

export interface ScreencastFrame {
  data: string;
  sessionId: number;
  metadata: {
    offsetTop?: number;
    pageScaleFactor?: number;
    deviceWidth?: number;
    deviceHeight?: number;
    scrollOffsetX?: number;
    scrollOffsetY?: number;
    timestamp?: number;
  };
}

export interface StartScreencastOptions {
  format?: 'jpeg' | 'png';
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  everyNthFrame?: number;
}

export async function newCdpSession(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

export async function startScreencast(cdp: CDPSession, opts: StartScreencastOptions): Promise<void> {
  // Page domain must be enabled on this CDP session before screencast frames
  // will fire — Playwright's high-level wrapper auto-enables it on its own
  // session, but newCDPSession() creates a separate channel that needs its
  // own enable.
  await cdp.send('Page.enable');
  await cdp.send('Page.startScreencast', {
    format: opts.format ?? 'jpeg',
    quality: opts.quality ?? 70,
    maxWidth: opts.maxWidth,
    maxHeight: opts.maxHeight,
    everyNthFrame: opts.everyNthFrame ?? 1,
  });
}

export async function stopScreencast(cdp: CDPSession): Promise<void> {
  try {
    await cdp.send('Page.stopScreencast');
  } catch {
    // Page may already be closed; ignore.
  }
}

export async function ackFrame(cdp: CDPSession, sessionId: number): Promise<void> {
  try {
    await cdp.send('Page.screencastFrameAck', { sessionId });
  } catch {
    // Stream may have been torn down; ignore.
  }
}

export interface MouseEventOpts {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
  x: number;
  y: number;
  button?: 'none' | 'left' | 'middle' | 'right';
  modifiers?: number;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
}

export async function dispatchMouseEvent(cdp: CDPSession, opts: MouseEventOpts): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', {
    type: opts.type,
    x: opts.x,
    y: opts.y,
    button: opts.button ?? 'none',
    modifiers: opts.modifiers ?? 0,
    clickCount: opts.clickCount ?? (opts.type === 'mousePressed' || opts.type === 'mouseReleased' ? 1 : 0),
    deltaX: opts.deltaX,
    deltaY: opts.deltaY,
  });
}

export interface KeyEventOpts {
  type: 'keyDown' | 'keyUp';
  key: string;
  code: string;
  modifiers?: number;
  text?: string;
}

export async function dispatchKeyEvent(cdp: CDPSession, opts: KeyEventOpts): Promise<void> {
  await cdp.send('Input.dispatchKeyEvent', {
    type: opts.type,
    key: opts.key,
    code: opts.code,
    modifiers: opts.modifiers ?? 0,
    text: opts.text,
  });
}

export async function getViewport(page: Page): Promise<{ width: number; height: number }> {
  const size = page.viewportSize();
  if (size) return { width: size.width, height: size.height };
  // The callback is serialized and executed in the browser context, where globalThis is the
  // window. Access it via a typed globalThis so this compiles without the DOM lib (the api
  // package builds with lib: ES2022 only).
  const dims = await page.evaluate(() => {
    const w = globalThis as unknown as { innerWidth: number; innerHeight: number };
    return { width: w.innerWidth, height: w.innerHeight };
  });
  return dims;
}
