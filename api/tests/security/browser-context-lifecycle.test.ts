import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalBrowserSession } from '../../src/automation/local-browser-session.js';
import { setLocalBrowserContextProvider, __resetAutomationSeamsForTests } from '../../src/automation/seams.js';

/**
 * SECURITY SUITE — the run's browser context is closed, and the sharing model is as documented
 * (Cofre G-3).
 *
 * `dispose()` closed only the PAGE, so every run leaked its context — and with it the whole cookie
 * jar of an authenticated session — for the lifetime of the process. Separately, the module's
 * docblock described "the owner's PERSISTENT context" with concurrent runs sharing cookies, while
 * the composition root has always handed back `browser.newContext()`. Reading the docblock instead
 * of the composition root produced wrong audit conclusions twice, so the behaviour is now pinned.
 */
function fakeContext() {
  // Complete enough for observe() -> capture(): a successful screenshot (so the retry path is not
  // taken), the mask locator lookup, and the fingerprint probe (which capture() already guards
  // with .catch, so a throw there is harmless).
  const page = {
    isClosed: () => false,
    close: vi.fn(async () => undefined),
    url: () => 'about:blank',
    title: vi.fn(async () => ''),
    locator: (sel: string) => ({ __sel: sel }),
    screenshot: vi.fn(async () => Buffer.from('PNG')),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => ({})),
    viewportSize: () => ({ width: 1440, height: 900 }),
  };
  const ctx = {
    newPage: vi.fn(async () => page),
    addCookies: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  return { ctx, page };
}

let made: Array<ReturnType<typeof fakeContext>>;

beforeEach(() => {
  made = [];
  setLocalBrowserContextProvider(async () => {
    const c = fakeContext();
    made.push(c);
    return c.ctx as never;
  });
});

afterEach(() => __resetAutomationSeamsForTests());

describe('LocalBrowserSession context lifecycle', () => {
  it('closes the CONTEXT as well as the page on dispose', async () => {
    const s = new LocalBrowserSession({ runId: 'r1', ownerUserId: 'u1' });
    await s.observe(); // forces ensurePage()
    expect(made).toHaveLength(1);
    await s.dispose();
    expect(made[0]!.page.close).toHaveBeenCalled();
    // The decisive assertion: the context owns the cookie jar, and closing the page alone does not
    // discard it. This leaked on every run before G-3.
    expect(made[0]!.ctx.close).toHaveBeenCalled();
  });

  it('gives each session its OWN context — no cookie jar is shared across runs', async () => {
    const a = new LocalBrowserSession({ runId: 'r1', ownerUserId: 'u1' });
    const b = new LocalBrowserSession({ runId: 'r2', ownerUserId: 'u1' });
    await a.observe();
    await b.observe();
    expect(made).toHaveLength(2);
    expect(made[0]!.ctx).not.toBe(made[1]!.ctx);
    await a.dispose();
    await b.dispose();
  });

  it('dispose is idempotent and does not throw a second time', async () => {
    const s = new LocalBrowserSession({ runId: 'r1', ownerUserId: 'u1' });
    await s.observe();
    await s.dispose();
    await expect(s.dispose()).resolves.toBeUndefined();
    expect(made[0]!.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('a context-close failure never fails teardown of a completed run', async () => {
    setLocalBrowserContextProvider(async () => {
      const c = fakeContext();
      c.ctx.close = vi.fn(async () => {
        throw new Error('already closing');
      });
      made.push(c);
      return c.ctx as never;
    });
    const s = new LocalBrowserSession({ runId: 'r1', ownerUserId: 'u1' });
    await s.observe();
    await expect(s.dispose()).resolves.toBeUndefined();
  });

  it('re-opening after dispose acquires a FRESH context, not the closed one', async () => {
    const s = new LocalBrowserSession({ runId: 'r1', ownerUserId: 'u1' });
    await s.observe();
    await s.dispose();
    await s.observe();
    expect(made).toHaveLength(2);
    expect(made[1]!.ctx).not.toBe(made[0]!.ctx);
    await s.dispose();
  });
});
