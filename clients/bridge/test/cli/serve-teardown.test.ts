import { describe, it, expect } from 'vitest';
import { installShutdown, teardownBrowsers } from '../../src/cli/commands/serve.js';
import { pt } from '../../src/i18n/pt.js';

/**
 * SHUTDOWN MUST WIPE THE JAR BEFORE THE PROCESS GOES.
 *
 * `ProfileManager.closeAll` releases live RUN leases before closing their contexts, and that
 * release is what clears an injected Cofre session out of the jar. The profile is PERSISTENT - its
 * cookies are a file on disk - so a shutdown that does not wait for the wipe can exit with a live
 * session written under the profile directory, which the next run inherits.
 *
 * The old `void profiles.closeAll()` was harmless only while every lease was released at the end of
 * its own invoke; with run-scoped leases, a run in flight at SIGINT is exactly the case that has
 * something to wipe.
 *
 * TWO LEVELS, BOTH NEEDED. `teardownBrowsers` is the wait and its bound. `installShutdown` is the
 * WIRING - that the signal handler actually calls it and that nothing announces the daemon stopped
 * until it has resolved. An earlier version of this file tested only the first, and restoring the
 * exact pre-change `void profiles.closeAll()` in `serve.ts` left the whole suite green: the file
 * asserted the mechanism while the claim in this very docblock went unpinned.
 */
describe('teardownBrowsers - the wait and its bound', () => {
  it('WAITS for closeAll to finish before it returns', async () => {
    let wiped = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const profiles = {
      closeAll: async (): Promise<void> => {
        await gate;
        wiped = true;
      },
    };

    let returned = false;
    const done = teardownBrowsers(profiles, () => undefined, 5_000).then(() => {
      returned = true;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(returned).toBe(false); // still waiting on the wipe
    expect(wiped).toBe(false);

    release();
    await done;
    expect(wiped).toBe(true);
  });

  it('gives up after the deadline and SAYS SO rather than hanging the daemon', async () => {
    let told = false;
    const profiles = { closeAll: (): Promise<void> => new Promise<void>(() => undefined) }; // never settles
    await teardownBrowsers(profiles, () => (told = true), 20);
    expect(told).toBe(true);
  });

  it('does not warn when the teardown completed in time', async () => {
    let told = false;
    await teardownBrowsers({ closeAll: async (): Promise<void> => undefined }, () => (told = true), 5_000);
    expect(told).toBe(false);
  });

  it('never throws - a failed teardown must not stop the daemon from exiting', async () => {
    await expect(
      teardownBrowsers({ closeAll: async (): Promise<void> => Promise.reject(new Error('browser wedged')) }, () => undefined, 5_000),
    ).resolves.toBeUndefined();
  });
});

/** A shutdown harness: every collaborator a signal touches, recording the order it touched them. */
function harness(closeAll: () => Promise<void>) {
  const order: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const handlers = new Map<string, () => void>();
  const stopped = installShutdown({
    io: {
      out: (m: string) => {
        order.push(`out:${m}`);
        out.push(m);
      },
      err: (m: string) => {
        order.push(`err:${m}`);
        err.push(m);
      },
    } as unknown as Parameters<typeof installShutdown>[0]['io'],
    socket: { close: () => void order.push('socket.close') },
    runtime: { zeroizeSecrets: () => void order.push('zeroizeSecrets') },
    profiles: {
      closeAll: async () => {
        order.push('closeAll.start');
        await closeAll();
        order.push('closeAll.done');
      },
    },
    surface: () => ({
      close: async () => {
        order.push('surface.close');
      },
    }),
    onExit: () => void order.push('pidfile.remove'),
    teardownMs: 50,
    onSignal: (signal, handler) => void handlers.set(signal, handler),
  });
  return { order, out, err, handlers, stopped };
}

describe('the SIGINT/SIGTERM wiring - what a signal actually does', () => {
  it('registers a handler for BOTH signals', () => {
    const h = harness(async () => undefined);
    expect([...h.handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);
    h.handlers.get('SIGINT')!();
  });

  it('does not resolve, or say the daemon stopped, until the browser wipe has finished', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const h = harness(() => gate);

    let exited = false;
    void h.stopped.then(() => {
      exited = true;
    });
    h.handlers.get('SIGINT')!();
    await new Promise((r) => setTimeout(r, 20));

    // THE ASSERTION. The wipe is in flight; the daemon has NOT announced it stopped and the serve
    // promise has NOT resolved, so the process is not free to exit with a live session on disk.
    expect(h.order).toContain('closeAll.start');
    expect(h.order).not.toContain('closeAll.done');
    expect(h.out).not.toContain(pt.serveStopped);
    expect(exited).toBe(false);

    release();
    await expect(h.stopped).resolves.toBe(0);
    expect(h.order.indexOf('closeAll.done')).toBeLessThan(h.order.indexOf(`out:${pt.serveStopped}`));
  });

  it('overwrites the held secrets BEFORE it touches a browser', async () => {
    // A shutdown that closes browsers first is a shutdown that can be interrupted with credential
    // material still resident in this process.
    const h = harness(async () => undefined);
    h.handlers.get('SIGTERM')!();
    await h.stopped;
    expect(h.order.indexOf('zeroizeSecrets')).toBeLessThan(h.order.indexOf('closeAll.start'));
    expect(h.order.indexOf('socket.close')).toBeLessThan(h.order.indexOf('zeroizeSecrets'));
  });

  it('holds the pidfile until the profiles are actually free', async () => {
    // The pidfile is the CROSS-PROCESS lock on the profile directory: `browser/profile.ts` rests
    // its "an in-process mutex is sufficient" argument on `serve` refusing a second daemon on the
    // same home. Dropping it while Chromium is still shutting down lets a second daemon launch
    // against a userDataDir this one has not released - the SingletonLock collision the lock exists
    // to prevent.
    const h = harness(async () => undefined);
    h.handlers.get('SIGINT')!();
    await h.stopped;
    expect(h.order.indexOf('closeAll.done')).toBeLessThan(h.order.indexOf('pidfile.remove'));
  });

  it('still drops the pidfile when the teardown timed out - a stale lock is worse than a slow one', async () => {
    const h = harness(() => new Promise<void>(() => undefined));
    h.handlers.get('SIGINT')!();
    await h.stopped;
    expect(h.order).toContain('pidfile.remove');
  });

  it('tells the operator a window may be open when the wipe outlives its deadline', async () => {
    const h = harness(() => new Promise<void>(() => undefined)); // never settles
    h.handlers.get('SIGINT')!();
    await expect(h.stopped).resolves.toBe(0);
    expect(h.err.some((m) => m.includes(pt.serveTeardownTimedOut))).toBe(true);
  });

  it('is idempotent - a second signal does not run the teardown twice', async () => {
    const h = harness(async () => undefined);
    h.handlers.get('SIGINT')!();
    h.handlers.get('SIGTERM')!();
    h.handlers.get('SIGINT')!();
    await h.stopped;
    expect(h.order.filter((o) => o === 'closeAll.start')).toHaveLength(1);
  });
});
