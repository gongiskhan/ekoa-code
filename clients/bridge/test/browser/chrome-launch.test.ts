import { describe, it, expect } from 'vitest';
import { existsSync, lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  launchHeadedRealChrome,
  sweepSingletonMarkers,
  type HeadedChromeContext,
  type PersistentContextLauncher,
} from '../../src/browser/chrome-launch.js';
import {
  BrowserUnavailableError,
  WEBDRIVER_INIT_SCRIPT,
  SAME_TAB_INIT_SCRIPT,
  OFFSCREEN_WINDOW_LEFT,
  OFFSCREEN_WINDOW_TOP,
} from '../../src/browser/index.js';

/**
 * The shared launch primitive the attended ceremony opens its window with. These assert the REALNESS
 * hygiene (real Chrome first, the infobar suppressed, the webdriver tell removed) and the recovery a
 * crashed browser needs — without ever launching a real browser, exactly like the profile lease
 * tests. The one display-bound thing (that a headed window actually appears) is a live-verification
 * concern and is not gated here.
 */

function fakeContext(): HeadedChromeContext {
  return {
    pages: () => [],
    newPage: async () => ({ goto: async () => undefined, url: () => 'about:blank', on: () => undefined }),
    addInitScript: async () => undefined,
    storageState: async () => ({ cookies: [], origins: [] }),
    close: async () => undefined,
    on: () => undefined,
  };
}

describe('launchHeadedRealChrome — the ceremony window, hygiene and recovery', () => {
  it('tries the REAL installed Chrome first, and passes the anti-automation hygiene', async () => {
    const seen: Array<{ dir: string; opts: Record<string, unknown> }> = [];
    const launch: PersistentContextLauncher = async (dir, opts) => {
      seen.push({ dir, opts });
      return fakeContext();
    };
    const dir = mkdtempSync(join(tmpdir(), 'ekoa-ceremony-'));
    try {
      await launchHeadedRealChrome(dir, { launch });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]!.opts.channel).toBe('chrome'); // real Chrome, not bundled chromium
    expect(seen[0]!.opts.headless).toBe(false);
    expect(seen[0]!.opts.args).toContain('--disable-blink-features=AutomationControlled');
    // The infobar suppression: no "controlled by automated test software" banner over a human's login.
    expect(seen[0]!.opts.ignoreDefaultArgs).toContain('--enable-automation');
  });

  it('removes the webdriver tell AND keeps the ceremony in one tab on the context it returns', async () => {
    const scripts: string[] = [];
    const launch: PersistentContextLauncher = async () => ({
      ...fakeContext(),
      addInitScript: async (s: string) => void scripts.push(s),
    });
    const dir = mkdtempSync(join(tmpdir(), 'ekoa-ceremony-'));
    try {
      await launchHeadedRealChrome(dir, { launch });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(scripts).toContain(WEBDRIVER_INIT_SCRIPT);
    // The same-tab script keeps new-tab/popup opens in the streamed tab so the window is not raised
    // repeatedly and the login stays visible (the "takes over the computer" fix).
    expect(scripts).toContain(SAME_TAB_INIT_SCRIPT);
  });

  it('hides the window OFF-SCREEN at launch via CDP (not minimized), with a re-callable seam', async () => {
    // The window is placed off every display so it cannot take over the desktop, but stays in NORMAL
    // state (minimized freezes compositing on macOS -> black stream). Pins the off-screen bounds, that
    // it launches off-screen too, and that the seam re-hides (called on navigation).
    const cdpCalls: Array<{ method: string; params?: unknown }> = [];
    const fakeCdp = {
      send: async (method: string, params?: unknown) => {
        cdpCalls.push({ method, params });
        return method === 'Browser.getWindowForTarget' ? { windowId: 42 } : undefined;
      },
      on: () => undefined,
    };
    const ctx = {
      ...fakeContext(),
      pages: () => [{ goto: async () => undefined, url: () => 'about:blank', on: () => undefined }],
      // page-taking newCDPSession, exactly as Playwright exposes; attachCdpSeam wraps it 0-arg.
      newCDPSession: async (_page: unknown) => fakeCdp,
    } as unknown as HeadedChromeContext;
    const seen: Array<{ opts: Record<string, unknown> }> = [];
    const launch: PersistentContextLauncher = async (_dir, opts) => {
      seen.push({ opts });
      return ctx;
    };
    const dir = mkdtempSync(join(tmpdir(), 'ekoa-ceremony-'));
    try {
      const out = await launchHeadedRealChrome(dir, { launch });
      // Launched off-screen so the window never flashes onto the desktop.
      expect(seen[0]!.opts.args).toContain(`--window-position=${OFFSCREEN_WINDOW_LEFT},${OFFSCREEN_WINDOW_TOP}`);
      const bounds = cdpCalls.filter((c) => c.method === 'Browser.setWindowBounds');
      expect(bounds).toHaveLength(1); // hidden once at launch
      expect(bounds[0]!.params).toMatchObject({
        windowId: 42,
        bounds: { left: OFFSCREEN_WINDOW_LEFT, top: OFFSCREEN_WINDOW_TOP, windowState: 'normal' },
      });
      await out.minimizeWindow?.(); // re-hide (the navigation path) works and reuses the windowId
      expect(cdpCalls.filter((c) => c.method === 'Browser.setWindowBounds')).toHaveLength(2);
      expect(cdpCalls.filter((c) => c.method === 'Browser.getWindowForTarget')).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('headless mode launches windowless and skips the off-screen window management', async () => {
    // On a same-machine bridge the operator opts into headless so the headed window's macOS
    // app-activation cannot steal focus from the panel. Headless has no window, so it is neither
    // positioned off-screen nor hidden via CDP.
    const cdpCalls: string[] = [];
    const fakeCdp = { send: async (m: string) => (cdpCalls.push(m), undefined), on: () => undefined };
    const ctx = {
      ...fakeContext(),
      pages: () => [{ goto: async () => undefined, url: () => 'about:blank', on: () => undefined }],
      newCDPSession: async (_page: unknown) => fakeCdp,
    } as unknown as HeadedChromeContext;
    const seen: Array<{ opts: Record<string, unknown> }> = [];
    const launch: PersistentContextLauncher = async (_dir, opts) => (seen.push({ opts }), ctx);
    const dir = mkdtempSync(join(tmpdir(), 'ekoa-ceremony-'));
    try {
      await launchHeadedRealChrome(dir, { launch, headless: true });
      expect(seen[0]!.opts.headless).toBe(true);
      expect(seen[0]!.opts.args).not.toContain(`--window-position=${OFFSCREEN_WINDOW_LEFT},${OFFSCREEN_WINDOW_TOP}`);
      expect(cdpCalls).not.toContain('Browser.setWindowBounds'); // no window to hide
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the bundled browser (no channel) when real Chrome is absent', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const launch: PersistentContextLauncher = async (_dir, opts) => {
      seen.push(opts);
      if (opts.channel === 'chrome') throw new Error('Chromium distribution "chrome" is not found');
      return fakeContext();
    };
    const dir = mkdtempSync(join(tmpdir(), 'ekoa-ceremony-'));
    try {
      await launchHeadedRealChrome(dir, { launch });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(seen).toHaveLength(2);
    expect(seen[0]!.channel).toBe('chrome');
    expect(seen[1]!.channel).toBeUndefined(); // the bundled fallback
  });

  it('reports a machine with NO browser by name, with the install command', async () => {
    const launch: PersistentContextLauncher = async () => {
      throw new Error("Executable doesn't exist at /path/to/chromium");
    };
    const dir = mkdtempSync(join(tmpdir(), 'ekoa-ceremony-'));
    try {
      await expect(launchHeadedRealChrome(dir, { launch })).rejects.toBeInstanceOf(BrowserUnavailableError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sweepSingletonMarkers — the lock a crashed real Chrome actually leaves', () => {
  it('clears the DANGLING symlink existsSync cannot see', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ekoa-ceremony-'));
    try {
      // Real Chrome writes SingletonLock as a symlink to <host>-<pid>, a target that never exists.
      symlinkSync('somehost-31337', join(dir, 'SingletonLock'));
      expect(existsSync(join(dir, 'SingletonLock'))).toBe(false); // the whole problem, in one line
      expect(() => lstatSync(join(dir, 'SingletonLock'))).not.toThrow();
      sweepSingletonMarkers(dir);
      expect(() => lstatSync(join(dir, 'SingletonLock'))).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('clears a plain stale lock file too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ekoa-ceremony-'));
    try {
      writeFileSync(join(dir, 'SingletonLock'), 'stale');
      sweepSingletonMarkers(dir);
      expect(existsSync(join(dir, 'SingletonLock'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when there is nothing to clear', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ekoa-ceremony-'));
    try {
      expect(() => sweepSingletonMarkers(dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the ceremony window is a normal window: one tab, its login persists', () => {
  it('reuses the persistent context DEFAULT page rather than opening a second tab', async () => {
    const { ceremonyBrowserOverContext } = await import('../../src/attended/index.js');
    let newPageCalls = 0;
    const defaultPage = { goto: async () => undefined, url: () => 'about:blank', on: () => undefined };
    const ctx: HeadedChromeContext = {
      ...fakeContext(),
      pages: () => [defaultPage],
      newPage: async () => {
        newPageCalls += 1;
        return { goto: async () => undefined, url: () => 'about:blank', on: () => undefined };
      },
    };
    const browser = ceremonyBrowserOverContext(ctx);
    const context = await browser.newContext();
    const page = await context.newPage();
    expect(page).toBe(defaultPage); // the window's existing tab
    expect(newPageCalls).toBe(0); // never opened a second one
  });

  it('maps the window closing to the ceremony completion signal', async () => {
    const { ceremonyBrowserOverContext } = await import('../../src/attended/index.js');
    let closeHandler: (() => void) | null = null;
    const ctx: HeadedChromeContext = {
      ...fakeContext(),
      on: (_event, handler) => {
        closeHandler = handler;
      },
    };
    const browser = ceremonyBrowserOverContext(ctx);
    let disconnected = false;
    browser.on('disconnected', () => {
      disconnected = true;
    });
    closeHandler!(); // the human quit Chrome
    expect(disconnected).toBe(true);
  });
});

describe('hostKeyOf — one persistent profile per portal', () => {
  it('reduces an origin to a stable, filesystem-safe host key', async () => {
    const { hostKeyOf } = await import('../../src/attended/index.js');
    expect(hostKeyOf('https://orders.ubereats.com/list?x=1')).toBe('orders.ubereats.com');
    expect(hostKeyOf('https://orders.ubereats.com/other')).toBe('orders.ubereats.com'); // path-independent
    expect(hostKeyOf('portal.tribunais.org.pt')).toBe('portal.tribunais.org.pt');
  });
});
