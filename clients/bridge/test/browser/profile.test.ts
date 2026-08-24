import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProfileManager,
  ProfileError,
  BrowserUnavailableError,
  BROWSER_INSTALL_COMMAND,
  parseSessionState,
  sanitizeProfileId,
  WEBDRIVER_INIT_SCRIPT,
  type ProfileContext,
  type ProfileCookie,
  type ProfilePage,
  type PersistentLaunchOptions,
} from '../../src/browser/index.js';

/**
 * P1.1 - the persistent headed profile.
 *
 * NO TEST HERE LAUNCHES A BROWSER. The launcher is injected (the same pattern the attended ceremony
 * already uses), because the real launch is HEADED and a headed launch cannot run on a machine with
 * no display. What that buys is that the dispatch logic - where the profile lands, what options it
 * gets, how the mutex behaves, when the session is cleared - is exercised deterministically in the
 * unit lane, and the only thing left for a live pass is whether Chrome itself starts.
 */
interface FakePage extends ProfilePage {
  evaluated: string[];
  closed: boolean;
  setUrl(u: string): void;
}

function fakePage(url = 'about:blank'): FakePage {
  let current = url;
  const page: Partial<FakePage> = {
    evaluated: [],
    closed: false,
    url: () => current,
    setUrl: (u: string) => {
      current = u;
    },
    isClosed(): boolean {
      return page.closed === true;
    },
    close: async (): Promise<void> => {
      page.closed = true;
    },
    evaluate: async (script: string): Promise<unknown> => {
      page.evaluated!.push(script);
      return '';
    },
  };
  return page as FakePage;
}

interface FakeContext extends ProfileContext {
  cookiesAdded: ProfileCookie[][];
  cleared: number;
  initScripts: string[];
  openPages: FakePage[];
  closed: boolean;
}

function fakeContext(): FakeContext {
  const ctx: Partial<FakeContext> = {
    cookiesAdded: [],
    cleared: 0,
    initScripts: [],
    openPages: [],
    closed: false,
    newPage: async (): Promise<ProfilePage> => {
      const p = fakePage();
      ctx.openPages!.push(p);
      return p;
    },
    pages: (): ProfilePage[] => ctx.openPages!,
    addCookies: async (c: ProfileCookie[]): Promise<void> => {
      ctx.cookiesAdded!.push(c);
    },
    clearCookies: async (): Promise<void> => {
      ctx.cleared = (ctx.cleared ?? 0) + 1;
    },
    addInitScript: async (s: string): Promise<void> => {
      ctx.initScripts!.push(s);
    },
    close: async (): Promise<void> => {
      ctx.closed = true;
    },
  };
  return ctx as FakeContext;
}

let home: string;
let launches: Array<{ dir: string; opts: PersistentLaunchOptions }>;
let contexts: FakeContext[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ekoa-profile-'));
  launches = [];
  contexts = [];
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function manager(overrides: { failChannel?: boolean } = {}): ProfileManager {
  return new ProfileManager({
    home,
    idleCloseMs: 0,
    launch: async (dir, opts) => {
      launches.push({ dir, opts });
      if (overrides.failChannel && opts.channel === 'chrome') throw new Error("Executable doesn't exist");
      const ctx = fakeContext();
      contexts.push(ctx);
      return ctx;
    },
  });
}

describe('WHERE the profile lands - never the user own Chrome', () => {
  it('creates <EKOA_BRIDGE_HOME>/profiles/<id>', async () => {
    const m = manager();
    await (await m.acquire('acme')).release();
    expect(launches[0]!.dir).toBe(join(home, 'profiles', 'acme'));
    expect(existsSync(join(home, 'profiles', 'acme'))).toBe(true);
  });

  it('is 0700 - a profile directory holds live cookies', async () => {
    const m = manager();
    await (await m.acquire('acme')).release();
    const mode = statSync(join(home, 'profiles', 'acme')).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('re-asserts 0700 on a directory that already existed (recursive mkdir does NOT set the mode)', async () => {
    mkdirSync(join(home, 'profiles', 'acme'), { recursive: true, mode: 0o755 });
    const m = manager();
    await (await m.acquire('acme')).release();
    expect(statSync(join(home, 'profiles', 'acme')).mode & 0o777).toBe(0o700);
  });

  it('NEVER lands inside the user real home browser directories', async () => {
    const m = manager();
    await (await m.acquire('acme')).release();
    const dir = launches[0]!.dir;
    expect(dir.startsWith(home)).toBe(true);
    for (const forbidden of [
      join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
      join(homedir(), '.config', 'google-chrome'),
      join(homedir(), '.config', 'chromium'),
    ]) {
      expect(dir.startsWith(forbidden)).toBe(false);
    }
  });

  it('folds a hostile profileId into a safe directory name - the id is attacker-influenced text that becomes a PATH', () => {
    expect(sanitizeProfileId('../../etc/passwd')).not.toContain('..');
    expect(sanitizeProfileId('../../etc/passwd')).not.toContain('/');
    expect(sanitizeProfileId('/absolute')).not.toMatch(/^\//);
    expect(sanitizeProfileId('')).toBe('default');
  });

  it('a traversal id cannot escape the profiles root', async () => {
    const m = manager();
    await (await m.acquire('../../escape')).release();
    expect(launches[0]!.dir.startsWith(join(home, 'profiles'))).toBe(true);
  });
});

describe('realness is hygiene, not a stealth stack', () => {
  it('asks for real installed Chrome, headed, with the automation flag off', async () => {
    const m = manager();
    await (await m.acquire('acme')).release();
    const opts = launches[0]!.opts;
    expect(opts.channel).toBe('chrome');
    expect(opts.headless).toBe(false);
    expect(opts.args).toContain('--disable-blink-features=AutomationControlled');
    expect(opts.viewport).toEqual({ width: 1280, height: 800 });
  });

  it('falls back to bundled chromium when Chrome is absent - a fallback, not a preference', async () => {
    const m = manager({ failChannel: true });
    await (await m.acquire('acme')).release();
    expect(launches).toHaveLength(2);
    expect(launches[0]!.opts.channel).toBe('chrome');
    expect(launches[1]!.opts.channel).toBeUndefined();
  });

  it('removes the navigator.webdriver tell via an init script', async () => {
    const m = manager();
    await (await m.acquire('acme')).release();
    expect(contexts[0]!.initScripts).toContain(WEBDRIVER_INIT_SCRIPT);
    expect(WEBDRIVER_INIT_SCRIPT).toContain('webdriver');
  });
});

/**
 * A MISSING BROWSER IS A CONFIGURATION ERROR, NOT A SLOW PAGE.
 *
 * Measured live (findings, `ad-hoc-adversarial-browser-run-pauses-in-process-not-durably`): an
 * acceptance run against a bridge that had no chromium installed spent the whole 120s invocation
 * window and came back as "the machine did not answer in time" - a timeout naming nothing anybody
 * could act on, from the side that knew exactly what was wrong.
 *
 * The two strings below are Playwright 1.62's own, taken from a real failed launch (a missing
 * `channel`, and a `PLAYWRIGHT_BROWSERS_PATH` pointing at an empty directory). Only the bundled
 * message's box-drawing FRAME is dropped, its text is verbatim: a classifier that matches invented
 * prose proves nothing about the messages it will actually meet.
 */
const PW_CHANNEL_MISSING =
  "browserType.launchPersistentContext: Chromium distribution 'chrome' is not found at " +
  '/opt/google/chrome/chrome\nRun "npx playwright install chrome"';

const PW_BUNDLED_MISSING =
  "browserType.launchPersistentContext: Executable doesn't exist at " +
  '/home/someone/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome\n' +
  'Looks like Playwright was just installed or updated.\n' +
  'Please run the following command to download new browsers:\n' +
  '    npx playwright install';

function managerWithLauncher(launch: (opts: PersistentLaunchOptions) => Promise<ProfileContext>): ProfileManager {
  return new ProfileManager({
    home,
    idleCloseMs: 0,
    launch: async (dir, opts) => {
      launches.push({ dir, opts });
      return launch(opts);
    },
  });
}

describe('a browser that is NOT INSTALLED fails fast and by name', () => {
  it('names the one command that fixes it, and does not hand the user Playwright prose', async () => {
    const m = managerWithLauncher(async (opts) => {
      // Both attempts answer at once, which is what Playwright really does for a missing binary.
      await new Promise((r) => setTimeout(r, 5));
      throw new Error(opts.channel ? PW_CHANNEL_MISSING : PW_BUNDLED_MISSING);
    });

    const startedAt = Date.now();
    const err = await m.acquire('acme').then(
      () => null,
      (e: unknown) => e,
    );
    const elapsedMs = Date.now() - startedAt;

    expect(err).toBeInstanceOf(BrowserUnavailableError);
    expect((err as Error).message).toContain(BROWSER_INSTALL_COMMAND);
    expect(BROWSER_INSTALL_COMMAND).toBe('npx playwright install chromium');
    // Playwright's own wording, banner and all, is not what a person should be reading.
    expect((err as Error).message).not.toContain("Executable doesn't exist");
    // Fast: nowhere near a launch timeout, let alone Cortex's 120s invocation window.
    expect(elapsedMs).toBeLessThan(2_000);
  });

  it('does NOT call a transient launch failure a missing browser', async () => {
    const m = managerWithLauncher(async (opts) => {
      throw new Error(
        opts.channel ? PW_CHANNEL_MISSING : 'browserType.launchPersistentContext: Timeout 60000ms exceeded.',
      );
    });

    const err = await m.acquire('acme').then(
      () => null,
      (e: unknown) => e,
    );

    // A browser that is installed and would not start is worth retrying, and telling somebody to
    // reinstall a browser they already have is worse than saying nothing.
    expect(err).toBeInstanceOf(ProfileError);
    expect(err).not.toBeInstanceOf(BrowserUnavailableError);
    expect((err as Error).message).not.toContain(BROWSER_INSTALL_COMMAND);
    expect((err as Error).message).toContain('Timeout 60000ms exceeded');
  });

  it('spends ONE launch budget across both attempts, not one each', async () => {
    const m = managerWithLauncher(async (opts) => {
      if (opts.channel === 'chrome') {
        await new Promise((r) => setTimeout(r, 25));
        throw new Error(PW_CHANNEL_MISSING);
      }
      const ctx = fakeContext();
      contexts.push(ctx);
      return ctx;
    });
    await (await m.acquire('acme')).release();

    const first = launches[0]!.opts.timeout!;
    const second = launches[1]!.opts.timeout!;
    expect(second).toBeLessThan(first);
    expect(second).toBeGreaterThan(0);
    // The property that matters: the chain cannot reach the api's per-invocation window
    // (INVOCATION_TIMEOUT_MS = 120_000, api/src/bridge/tool-invocation.ts), so a launch that hangs
    // rather than throws still comes back as a bridge failure with a cause on it.
    expect(first + second).toBeLessThan(120_000);
  });
});

describe('LOCKING - a second run on one profile queues, it does not race', () => {
  it('serialises two acquires of the SAME profileId', async () => {
    const m = manager();
    const order: string[] = [];
    const first = await m.acquire('acme');
    order.push('first-acquired');

    let secondAcquired = false;
    const second = m.acquire('acme').then((lease) => {
      secondAcquired = true;
      order.push('second-acquired');
      return lease;
    });

    // The second acquire must NOT have resolved while the first lease is held: Chromium refuses a
    // second launch against a live userDataDir, so racing it is a launch failure, not a race we win.
    await new Promise((r) => setTimeout(r, 10));
    expect(secondAcquired).toBe(false);

    order.push('first-released');
    await first.release();
    await (await second).release();
    expect(order).toEqual(['first-acquired', 'first-released', 'second-acquired']);
  });

  it('launches the SAME userDataDir only once across serialised runs (the context is long-lived)', async () => {
    const m = manager();
    await (await m.acquire('acme')).release();
    await (await m.acquire('acme')).release();
    expect(launches).toHaveLength(1);
  });

  it('runs DISTINCT profileIds concurrently - different jars, no shared lock', async () => {
    const m = manager();
    const [a, b] = await Promise.all([m.acquire('alpha'), m.acquire('beta')]);
    expect(a.userDataDir).not.toBe(b.userDataDir);
    expect(launches).toHaveLength(2);
    await a.release();
    await b.release();
  });

  it('releases the mutex even when the RUN throws - a leaked lease deadlocks every later run', async () => {
    const m = manager();
    const lease = await m.acquire('acme');
    try {
      throw new Error('step blew up');
    } catch {
      await lease.release();
    }
    // If the mutex had leaked this would hang rather than resolve.
    await expect(Promise.race([m.acquire('acme'), timeout(500)])).resolves.toBeDefined();
  });

  it('clears a STALE SingletonLock left by a crash', async () => {
    const dir = join(home, 'profiles', 'acme');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SingletonLock'), 'stale');
    writeFileSync(join(dir, 'SingletonSocket'), 'stale');
    const m = manager();
    await (await m.acquire('acme')).release();
    expect(existsSync(join(dir, 'SingletonLock'))).toBe(false);
    expect(existsSync(join(dir, 'SingletonSocket'))).toBe(false);
  });
});

describe('SESSIONS come per run, not from the jar', () => {
  const session = parseSessionState({
    cookies: [{ name: 'sid', value: 'abc', domain: 'portal.test', path: '/' }],
    origins: [{ origin: 'https://portal.test', localStorage: [{ name: 'tok', value: 'xyz' }] }],
  })!;

  it('parses BOTH stored shapes (raw storageState and the capture wrapper)', () => {
    const wrapped = parseSessionState({ storageState: { cookies: [{ name: 'a', value: 'b', domain: 'x.test' }] }, capturedAt: 'now' });
    expect(wrapped?.cookies).toHaveLength(1);
    expect(parseSessionState({ cookies: [] })).toBeNull();
    expect(parseSessionState(null)).toBeNull();
  });

  it('drops cookies missing what addCookies needs rather than failing the whole run', () => {
    const parsed = parseSessionState({
      cookies: [
        { name: 'ok', value: 'v', domain: 'x.test' },
        { name: 'no-domain', value: 'v' },
        { value: 'no-name', domain: 'x.test' },
      ],
    });
    expect(parsed?.cookies.map((c) => c.name)).toEqual(['ok']);
  });

  it('INJECTS the run session cookies at acquire, before any navigation', async () => {
    const m = manager();
    const lease = await m.acquire('acme', session);
    expect(contexts[0]!.cookiesAdded[0]).toHaveLength(1);
    await lease.release();
  });

  it('seeds localStorage for the current origin, ONCE', async () => {
    const m = manager();
    const lease = await m.acquire('acme', session);
    const page = (await lease.page()) as FakePage;
    page.setUrl('https://portal.test/inbox');
    await lease.seedStorageForCurrentOrigin(page);
    await lease.seedStorageForCurrentOrigin(page);
    const seeds = page.evaluated.filter((s) => s.includes('setItem'));
    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toContain('tok');
    await lease.release();
  });

  it('does NOT seed an origin the session says nothing about', async () => {
    const m = manager();
    const lease = await m.acquire('acme', session);
    const page = (await lease.page()) as FakePage;
    page.setUrl('https://elsewhere.test/');
    await lease.seedStorageForCurrentOrigin(page);
    expect(page.evaluated.filter((s) => s.includes('setItem'))).toHaveLength(0);
    await lease.release();
  });

  it('CLEARS the session at run end - a session must never be left resident in a shared profile', async () => {
    const m = manager();
    const lease = await m.acquire('acme', session);
    const page = (await lease.page()) as FakePage;
    page.setUrl('https://portal.test/inbox');
    await lease.seedStorageForCurrentOrigin(page);
    await lease.release();
    expect(contexts[0]!.cleared).toBe(1);
    expect(page.evaluated.some((s) => s.includes('removeItem'))).toBe(true);
  });

  it('clears cookies even when NO session was injected - the jar is the daemon own, not a store', async () => {
    const m = manager();
    await (await m.acquire('acme')).release();
    expect(contexts[0]!.cleared).toBe(1);
  });

  it('closes the run page on release but keeps the CONTEXT warm', async () => {
    const m = manager();
    const lease = await m.acquire('acme');
    const page = (await lease.page()) as FakePage;
    await lease.release();
    expect(page.closed).toBe(true);
    expect(contexts[0]!.closed).toBe(false);
  });

  it('closeAll shuts every profile down (daemon shutdown)', async () => {
    const m = manager();
    await (await m.acquire('alpha')).release();
    await (await m.acquire('beta')).release();
    await m.closeAll();
    expect(contexts.every((c) => c.closed)).toBe(true);
    expect(m.openProfiles()).toEqual([]);
  });
});

function timeout(ms: number): Promise<never> {
  return new Promise((_r, reject) => setTimeout(() => reject(new Error('timed out')), ms));
}
