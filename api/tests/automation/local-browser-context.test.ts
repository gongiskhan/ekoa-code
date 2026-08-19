import { describe, it, expect } from 'vitest';
import type { Browser, BrowserContext } from 'playwright';
import { localBrowserContextProviderUsing } from '../../src/automation/seams.js';
import type { EgressResolution } from '../../src/automation/egress-policy.js';

/**
 * THE LAST MILE - where a resolved route becomes actually-proxied traffic.
 *
 * WHY THIS SUITE EXISTS. Every other test in this slice proves that the right ROUTE is DECIDED:
 * `locality.ts` picks it, the engine carries it, the seam accepts it. Not one of them proved it was
 * ever APPLIED. The application was three lines inside a closure in `server.ts` reaching straight
 * for `getSharedBrowser()`, so nothing could bind it and nothing did - reducing the body to
 * `return browser.newContext()`, i.e. every residential automation silently leaving from the
 * datacenter, left the entire repository green. That is the precise outcome P4.1 exists to prevent,
 * and it was undefended at the only point where prevention is physical rather than declarative.
 *
 * The direct import was what made it untestable, so the browser is now an argument. What follows
 * drives the REAL function with a recording browser: no stub of the thing under test, and the
 * assertions are on the launch options Chromium would actually have received.
 */

/** A browser that records the options `newContext` was called with, and nothing else. */
function recordingBrowser(): { browser: Browser; calls: Array<Record<string, unknown>>; persistentCalls: number } {
  const state = { calls: [] as Array<Record<string, unknown>>, persistentCalls: 0 };
  const browser = {
    newContext: async (options?: Record<string, unknown>) => {
      state.calls.push(options ?? {});
      return { marker: 'context' } as unknown as BrowserContext;
    },
    // NOT part of the contract, and present only so that reaching for it is OBSERVABLE rather than
    // a TypeError that could be mistaken for an unrelated failure. See the seam's docblock: a
    // persistent context turns `session-establishment.ts`'s post-login `storageState()` into a
    // capture of the owner's whole cross-site cookie jar.
    launchPersistentContext: async () => {
      state.persistentCalls += 1;
      return { marker: 'persistent' } as unknown as BrowserContext;
    },
  } as unknown as Browser;
  return { browser, get calls() { return state.calls; }, get persistentCalls() { return state.persistentCalls; } };
}

const MACHINE: EgressResolution = {
  outcome: 'machine',
  pairingId: 'pair_home',
  proxyUrl: 'http://100.64.0.7:1080',
};

describe('the local browser context provider applies the route it was handed', () => {
  it('launches THROUGH the machine proxy when the run resolved to one', async () => {
    const rec = recordingBrowser();
    const provider = localBrowserContextProviderUsing(async () => rec.browser);

    await provider('u1', MACHINE);

    // The load-bearing assertion of the whole slice: the residential line is a LAUNCH option, and
    // this is the only place it is ever set. Without it the traffic leaves from the datacenter with
    // every decision above it still reporting success.
    expect(rec.calls).toEqual([{ proxy: { server: 'http://100.64.0.7:1080' } }]);
  });

  it('opens a plain context for the datacenter route, exactly as it did before proxies existed', async () => {
    const rec = recordingBrowser();
    const provider = localBrowserContextProviderUsing(async () => rec.browser);

    await provider('u1', { outcome: 'datacenter', reason: 'no-requirement' });

    // No `proxy` key at all, rather than `proxy: undefined`: Playwright treats the two the same,
    // but the empty object is what the datacenter path has always built and what the lifecycle
    // suite asserts against.
    expect(rec.calls).toEqual([{}]);
  });

  it('opens a plain context when the caller declared no route at all', async () => {
    const rec = recordingBrowser();
    const provider = localBrowserContextProviderUsing(async () => rec.browser);

    await provider('u1');

    expect(rec.calls).toEqual([{}]);
  });

  it('never opens a PERSISTENT context - a whole cookie jar is not a session', async () => {
    const rec = recordingBrowser();
    const provider = localBrowserContextProviderUsing(async () => rec.browser);

    await provider('u1', MACHINE);
    await provider('u1', { outcome: 'datacenter', reason: 'no-requirement' });

    expect(rec.persistentCalls).toBe(0);
    expect(rec.calls).toHaveLength(2);
  });

  it('a refused or queued resolution gets no proxy - there is no line to leave by', async () => {
    const rec = recordingBrowser();
    const provider = localBrowserContextProviderUsing(async () => rec.browser);

    await provider('u1', { outcome: 'refused', reason: 'no machine' });
    await provider('u1', { outcome: 'queue', reason: 'no machine' });
    await provider('u1', { outcome: 'datacenter-fallback', reason: 'no machine' });

    // Those three never reach here through the run loop - `locality.ts` turns `refused` and `queue`
    // into halts, and `datacenter-fallback` is a declared datacenter choice - but the rendering is
    // defined for them, and defined as "no proxy" rather than as a crash.
    expect(rec.calls).toEqual([{}, {}, {}]);
  });

  it('asks its injected browser for the context, and asks it once per call', async () => {
    const rec = recordingBrowser();
    let opened = 0;
    const provider = localBrowserContextProviderUsing(async () => {
      opened += 1;
      return rec.browser;
    });

    await provider('u1', MACHINE);
    await provider('u2', MACHINE);

    // The composition root passes `getSharedBrowser`, whose own job is to launch Chromium at most
    // once; this only proves the provider goes through it rather than reaching for a browser of its
    // own, which is the property that made the old closure unbindable.
    expect(opened).toBe(2);
  });
});
