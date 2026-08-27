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
import { BrowserUnavailableError, WEBDRIVER_INIT_SCRIPT, SAME_TAB_INIT_SCRIPT } from '../../src/browser/index.js';

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
    cookies: async () => [],
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

  it('opts into headless when asked (same-machine bridge), else headed by default', async () => {
    // Headed (visible) is the default - lowest detection, and the human logs in directly in the window.
    // On a same-machine bridge the operator sets headless so the headed window's macOS app-activation
    // cannot steal keyboard focus from the panel.
    const seen: Array<{ opts: Record<string, unknown> }> = [];
    const launch: PersistentContextLauncher = async (_dir, opts) => (seen.push({ opts }), fakeContext());
    const dir = mkdtempSync(join(tmpdir(), 'ekoa-ceremony-'));
    try {
      await launchHeadedRealChrome(dir, { launch }); // default
      expect(seen[0]!.opts.headless).toBe(false);
      await launchHeadedRealChrome(dir, { launch, headless: true }); // opt-in
      expect(seen[1]!.opts.headless).toBe(true);
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
