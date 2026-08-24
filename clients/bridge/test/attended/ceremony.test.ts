import { describe, it, expect, vi } from 'vitest';
import { runAttendedCeremony, type CeremonyBrowser, type CeremonyContext, type CeremonyPage } from '../../src/attended/index.js';
import type { BridgeFrame } from '../../src/wire/index.js';

/**
 * The machine half of the attended ceremony (J-5). Playwright is substituted by a fake browser so
 * these assert the CEREMONY's behaviour — what gets pushed, what does not, and which origin is
 * reported — rather than that chromium launches.
 */

type Handlers = Record<string, Array<() => void>>;

class FakeBrowser implements CeremonyBrowser {
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

class FakeContext implements CeremonyContext {
  readonly handlers: Handlers = {};
  constructor(
    readonly page: FakePage,
    private state: unknown,
  ) {}
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

class FakePage implements CeremonyPage {
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

const LOGGED_IN = { cookies: [{ name: 'SESSION', value: 'x', domain: 'portal.tribunais.org.pt' }], origins: [] };
const EMPTY = { cookies: [], origins: [] };

function harness(opts: { url?: string; state?: unknown } = {}) {
  const page = new FakePage(opts.url ?? 'https://portal.tribunais.org.pt/inicio');
  const context = new FakeContext(page, opts.state ?? LOGGED_IN);
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

const REQ = {
  requestId: 'r-1',
  kind: 'card_login' as const,
  origin: 'https://portal.tribunais.org.pt',
  reason: 'Autenticação para Citius',
};

/** Close the window on the next tick so the snapshot loop runs at least once first. */
function closeSoon(h: ReturnType<typeof harness>, afterMs = 5): void {
  setTimeout(() => h.page.fire('close'), afterMs);
}

describe('attended ceremony — the machine half of J-5', () => {
  it('opens the origin CORTEX declared and pushes the captured session when the human closes the window', async () => {
    const h = harness();
    closeSoon(h);
    const ok = await runAttendedCeremony(REQ, h.deps);

    expect(ok).toBe(true);
    expect(h.page.gotoCalls).toEqual(['https://portal.tribunais.org.pt']);
    const push = h.sent.find((f) => f.type === 'session.push');
    expect(push).toMatchObject({ type: 'session.push', requestId: 'r-1', storageState: LOGGED_IN });
    expect(h.browser.closed).toBe(true);
  });

  it('reports the origin the browser ACTUALLY landed on, not the one requested', async () => {
    // Cortex compares the pushed origin against the ceremony's and refuses a mismatch. Echoing the
    // REQUESTED origin back would satisfy that check by construction and defeat it entirely — the
    // point is that Cortex learns where the session really came from.
    const h = harness({ url: 'https://sso.autenticacao.gov.pt/oauth/callback?code=abc' });
    closeSoon(h);
    await runAttendedCeremony(REQ, h.deps);

    const push = h.sent.find((f) => f.type === 'session.push');
    expect(push).toMatchObject({ origin: 'https://sso.autenticacao.gov.pt' });
    // and it carries no query string / path — an origin, not a URL
    expect((push as { origin: string }).origin).not.toContain('code=abc');
  });

  it('pushes NOTHING when the human closes the window without logging in', async () => {
    // An empty storageState would mint a valid, correctly-encrypted, USELESS Cofre item that later
    // looks like a working session — a silent failure surfacing only when an automation runs on it.
    const h = harness({ state: EMPTY });
    closeSoon(h);
    const ok = await runAttendedCeremony(REQ, h.deps);

    expect(ok).toBe(false);
    expect(h.sent.filter((f) => f.type === 'session.push')).toHaveLength(0);
    expect(h.logs.join('\n')).toContain('Nenhuma sessão foi capturada');
  });

  it('re-snapshots on navigation, so a login completed and closed inside one tick still travels', async () => {
    // The failure this pins: snapshotting ONLY on a 2s interval loses any human who logs in and
    // closes the window in between — and a card already in the reader is well inside 2s. A completed
    // login always ends in a redirect, so the navigation hook captures the state at the moment it
    // becomes real. Here the window opens empty, the human logs in, the portal redirects, and the
    // window closes — all faster than one tick.
    const h = harness({ state: EMPTY });
    setTimeout(() => {
      h.context.setState(LOGGED_IN);
      h.page.setUrl('https://portal.tribunais.org.pt/area-reservada');
      h.page.fire('framenavigated');
    }, 10);
    closeSoon(h, 60);
    const ok = await runAttendedCeremony(REQ, h.deps);

    expect(ok).toBe(true);
    expect(h.sent.find((f) => f.type === 'session.push')).toMatchObject({ storageState: LOGGED_IN });
  });

  it('captures at open too, so a window closed before any tick or navigation is not lost', async () => {
    const h = harness();
    closeSoon(h, 1); // closed immediately: only the open-time snapshot can have run
    const ok = await runAttendedCeremony(REQ, h.deps);

    expect(ok).toBe(true);
    expect(h.sent.find((f) => f.type === 'session.push')).toMatchObject({ storageState: LOGGED_IN });
  });

  it('reports failure and pushes nothing when the browser cannot launch', async () => {
    const sent: BridgeFrame[] = [];
    const logs: string[] = [];
    const ok = await runAttendedCeremony(REQ, {
      send: (f) => {
        sent.push(f);
        return true;
      },
      log: (m) => logs.push(m),
      launchBrowser: () => Promise.reject(new Error("Executable doesn't exist")),
      repairBrowser: () => Promise.resolve(),
    });

    expect(ok).toBe(false);
    expect(sent).toHaveLength(0);
    // `--force` matters: plain `playwright install` skips a version already on disk, so the advice
    // this prints has to be the form that actually repairs a truncated download.
    expect(logs.join('\n')).toContain('playwright install --force chromium');
  });

  it('reports honestly when the session was captured but the bridge link had dropped', async () => {
    const h = harness();
    const deps = { ...h.deps, send: () => false };
    closeSoon(h);
    const ok = await runAttendedCeremony(REQ, deps);

    expect(ok).toBe(false);
    expect(h.logs.join('\n')).toContain('a ligação ao Cortex caiu');
  });

  it('gives up on its own TTL rather than holding a window Cortex has already expired', async () => {
    const h = harness();
    let clock = 0;
    const now = (): number => clock;
    // Never close the window; advance past the daemon TTL instead.
    const run = runAttendedCeremony(REQ, { ...h.deps, now });
    await vi.waitFor(() => expect(h.page.gotoCalls.length).toBe(1));
    clock = 10 * 60_000;
    const ok = await run;

    expect(ok).toBe(false);
    expect(h.logs.join('\n')).toContain('demasiado tempo');
    expect(h.browser.closed).toBe(true);
  });

  /**
   * THE AD-HOC CEREMONY IS THE SAME CEREMONY (docs/decisions.md 2026-08-24, D-ADHOC-1).
   *
   * `login` joins `card_login` and `relay_code` as an attended kind, and this pins that it changes
   * NOTHING here: a card in a reader and a plain sign-in are the same errand from this machine's
   * point of view - open a headed window at the origin Cortex declared, hold it, push what the human
   * ends up with. If a `kind` branch ever appeared in `runAttendedCeremony`, the ad-hoc capture would
   * be a second implementation of the rail rather than a second caller of it, and this case is where
   * that shows up.
   */
  it('runs a `login` ceremony byte-for-byte like a card one - the kind is not a branch', async () => {
    const card = harness();
    closeSoon(card);
    await runAttendedCeremony(REQ, card.deps);

    const login = harness();
    closeSoon(login);
    const ok = await runAttendedCeremony({ ...REQ, kind: 'login' }, login.deps);

    expect(ok).toBe(true);
    expect(login.page.gotoCalls).toEqual(card.page.gotoCalls);
    expect(login.sent.find((f) => f.type === 'session.push')).toEqual(
      card.sent.find((f) => f.type === 'session.push'),
    );
    expect(login.logs).toEqual(card.logs);
  });

  it('normalises a bare host into an https origin before navigating', async () => {
    const h = harness();
    closeSoon(h);
    await runAttendedCeremony({ ...REQ, origin: 'portal.tribunais.org.pt' }, h.deps);
    expect(h.page.gotoCalls).toEqual(['https://portal.tribunais.org.pt']);
  });
});

/**
 * A HALF-DOWNLOADED BROWSER IS NOT A MISSING ONE.
 *
 * Observed on a real MacBook Air: it slept mid-`playwright install`, leaving
 * `chromium-1234` at 153 MB where a healthy build is 344 MB. The directory EXISTS, so
 * `Executable doesn't exist` never fires — the truncated binary launches and dies with SIGABRT,
 * which Playwright surfaces as "Target page, context or browser has been closed". The original
 * predicate only recognised absence, so the ceremony gave up on a machine one re-download from
 * working, every time, forever.
 */
describe('browser repair — the corrupt-install case the absence check missed', () => {
  const LAUNCH_CRASHES = [
    'browserType.launch: Target page, context or browser has been closed',
    'Failed to launch chromium because executable doesn\'t exist',
    '<process did exit: exitCode=null, signal=SIGABRT>',
  ];

  for (const message of LAUNCH_CRASHES) {
    it(`re-fetches and retries after: ${message.slice(0, 48)}...`, async () => {
      const sent: BridgeFrame[] = [];
      const logs: string[] = [];
      let attempts = 0;
      let repairs = 0;
      const h = harness();
      closeSoon(h, 5);

      const ok = await runAttendedCeremony(REQ, {
        send: (f) => {
          sent.push(f);
          return true;
        },
        log: (m) => logs.push(m),
        // First launch dies the way a truncated binary does; the retry after the re-fetch works.
        launchBrowser: () => {
          attempts += 1;
          return attempts === 1 ? Promise.reject(new Error(message)) : Promise.resolve(h.browser as CeremonyBrowser);
        },
        repairBrowser: () => {
          repairs += 1;
          return Promise.resolve();
        },
      });

      expect(repairs).toBe(1); // it re-fetched rather than trusting the directory on disk
      expect(attempts).toBe(2); // it did NOT give up on the first crash
      expect(ok).toBe(true);
      expect(sent.find((f) => f.type === 'session.push')).toBeDefined();
    });
  }

  it('does NOT re-fetch 150 MB for a failure a download cannot fix', async () => {
    // A refusal this does not recognise is re-thrown and reported. Re-downloading on the
    // off-chance, in front of a waiting human, is worse than saying what actually went wrong.
    let attempts = 0;
    let repairs = 0;
    const logs: string[] = [];
    const ok = await runAttendedCeremony(REQ, {
      send: () => true,
      log: (m) => logs.push(m),
      launchBrowser: () => {
        attempts += 1;
        return Promise.reject(new Error('EACCES: permission denied, mkdir /Users/x/Library/Caches'));
      },
      repairBrowser: () => {
        repairs += 1;
        return Promise.resolve();
      },
    });

    expect(repairs).toBe(0);
    expect(attempts).toBe(1);
    expect(ok).toBe(false);
    expect(logs.join('\n')).toContain('EACCES');
  });
});
