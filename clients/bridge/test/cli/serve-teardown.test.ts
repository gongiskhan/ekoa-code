import { describe, it, expect } from 'vitest';
import { teardownBrowsers } from '../../src/cli/commands/serve.js';

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
 * something to wipe. These assertions are about the WAIT and its bound.
 */
describe('teardownBrowsers - the shutdown path', () => {
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
