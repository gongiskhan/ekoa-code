import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProfileManager,
  parseSessionState,
  type ProfileContext,
  type ProfileCookie,
  type ProfilePage,
  type PersistentLaunchOptions,
} from '../../src/browser/index.js';

/**
 * THE RUN-SCOPED LEASE, and the three lifecycle bugs around it.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM profile.test.ts. That suite tests the LEASE PRIMITIVE - one
 * acquire, one release - and it passes both before and after this change, because the primitive was
 * never the bug. The bug was the LIFETIME: the executor took a lease per `tool.invoke` FRAME, and
 * Cortex sends one frame per act/assert/observe, so the page closed and the jar was cleared between
 * every pair of steps. Every assertion here is about the span between two steps, which is precisely
 * what a one-action-at-a-time test cannot see.
 *
 * NO TEST HERE LAUNCHES A BROWSER (same discipline as profile.test.ts: the launcher is injected,
 * the real launch is headed, and a headed launch cannot run on a box with no display).
 */
interface FakePage extends ProfilePage {
  id: number;
  evaluated: string[];
  closed: boolean;
  setUrl(u: string): void;
}

let nextPageId = 1;

function fakePage(): FakePage {
  let current = 'about:blank';
  const page: Partial<FakePage> = {
    id: nextPageId++,
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
  openPages: FakePage[];
  closed: boolean;
  /** When set, `close()` blocks on it. Lets a test hold a context in the "still closing" state. */
  closeGate?: Promise<void>;
  closeStarted: number;
}

function fakeContext(): FakeContext {
  const ctx: Partial<FakeContext> = {
    cookiesAdded: [],
    cleared: 0,
    openPages: [],
    closed: false,
    closeStarted: 0,
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
    addInitScript: async (): Promise<void> => undefined,
    close: async (): Promise<void> => {
      ctx.closeStarted = (ctx.closeStarted ?? 0) + 1;
      if (ctx.closeGate) await ctx.closeGate;
      ctx.closed = true;
    },
  };
  return ctx as FakeContext;
}

let home: string;
let launches: Array<{ dir: string; opts: PersistentLaunchOptions }>;
let contexts: FakeContext[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ekoa-runlease-'));
  launches = [];
  contexts = [];
  nextPageId = 1;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function manager(overrides: { runIdleMs?: number; idleCloseMs?: number } = {}): ProfileManager {
  return new ProfileManager({
    home,
    idleCloseMs: overrides.idleCloseMs ?? 0,
    ...(overrides.runIdleMs !== undefined ? { runIdleMs: overrides.runIdleMs } : { runIdleMs: 0 }),
    launch: async (dir, opts) => {
      launches.push({ dir, opts });
      const ctx = fakeContext();
      contexts.push(ctx);
      return ctx;
    },
  });
}

/** One `tool.invoke` worth of work: exactly what the executor does per step. */
async function step(
  m: ProfileManager,
  runId: string,
  fn: (page: FakePage) => void | Promise<void> = () => undefined,
  session?: ReturnType<typeof parseSessionState>,
): Promise<FakePage> {
  return m.withRunLease({ runId, profileId: 'acme', session: () => session ?? null }, async (lease) => {
    const page = (await lease.page()) as FakePage;
    await fn(page);
    return page;
  });
}

const SESSION = parseSessionState({
  cookies: [{ name: 'sid', value: 'abc', domain: 'portal.test', path: '/' }],
  origins: [{ origin: 'https://portal.test', localStorage: [{ name: 'tok', value: 'xyz' }] }],
})!;

describe('ONE PAGE AND ONE JAR FOR THE WHOLE RUN - the multi-step flow', () => {
  it('gives the SAME page back to every step of one run', async () => {
    // THE BUG. `runBrowserStep` acquired a lease per invoke and released it in a `finally`;
    // `ProfileLease.page()` holds `runPage` in the LEASE closure, so each acquire called
    // `context.newPage()`. A navigate landed, the lease released, the page closed - and the click
    // that followed ran on a brand-new about:blank.
    const m = manager();
    const first = await step(m, 'run-1', (p) => p.setUrl('https://portal.test/inbox'));
    const second = await step(m, 'run-1');
    expect(second.id).toBe(first.id);
    expect(second.url()).toBe('https://portal.test/inbox');
    expect(first.closed).toBe(false);
    expect(contexts[0]!.openPages).toHaveLength(1);
    await m.releaseRun('run-1');
  });

  it('does NOT clear the cookie jar between steps of the same run', async () => {
    // `release()` calls clearSession -> context.clearCookies() over the WHOLE jar. Per-invoke that
    // signed the run out after its very first step.
    const m = manager();
    await step(m, 'run-1', undefined, SESSION);
    await step(m, 'run-1');
    await step(m, 'run-1');
    expect(contexts[0]!.cleared).toBe(0);
    expect(contexts[0]!.cookiesAdded).toHaveLength(1); // injected ONCE, on the first step
    await m.releaseRun('run-1');
  });

  it('keeps seeded localStorage across steps - it is seeded once per origin, per RUN', async () => {
    const m = manager();
    const page = await step(
      m,
      'run-1',
      async (p) => {
        p.setUrl('https://portal.test/inbox');
      },
      SESSION,
    );
    await m.withRunLease({ runId: 'run-1', profileId: 'acme' }, async (lease) => {
      await lease.seedStorageForCurrentOrigin(page);
      await lease.seedStorageForCurrentOrigin(page);
    });
    expect(page.evaluated.filter((s) => s.includes('setItem'))).toHaveLength(1);
    await m.releaseRun('run-1');
  });

  it('resolves the Cofre session ONCE per run, not once per step', async () => {
    const m = manager();
    let resolved = 0;
    const session = (): typeof SESSION => {
      resolved += 1;
      return SESSION;
    };
    for (let i = 0; i < 4; i++) {
      await m.withRunLease({ runId: 'run-1', profileId: 'acme', session }, async (lease) => lease.page());
    }
    expect(resolved).toBe(1);
    await m.releaseRun('run-1');
  });

  it('gives a DIFFERENT run its own page and its own injection', async () => {
    const m = manager();
    const a = await step(m, 'run-1', (p) => p.setUrl('https://portal.test/a'), SESSION);
    await m.releaseRun('run-1');
    const b = await step(m, 'run-2', undefined, SESSION);
    expect(b.id).not.toBe(a.id);
    expect(b.url()).toBe('about:blank');
    expect(contexts[0]!.cookiesAdded).toHaveLength(2);
    await m.releaseRun('run-2');
  });
});

describe('THE RUN ENDS - explicitly, and the session goes with it', () => {
  it('clears the jar and closes the page on the explicit release', async () => {
    const m = manager();
    const page = await step(m, 'run-1', (p) => p.setUrl('https://portal.test/inbox'), SESSION);
    await m.withRunLease({ runId: 'run-1', profileId: 'acme' }, async (lease) => {
      await lease.seedStorageForCurrentOrigin(page);
    });
    expect(contexts[0]!.cleared).toBe(0);

    await m.releaseRun('run-1');

    expect(contexts[0]!.cleared).toBe(1);
    expect(page.closed).toBe(true);
    expect(page.evaluated.some((s) => s.includes('removeItem'))).toBe(true);
    // The CONTEXT stays warm for the next run; only the run's state went away.
    expect(contexts[0]!.closed).toBe(false);
    expect(m.openRuns()).toEqual([]);
  });

  it('is idempotent and safe for a run that never took a lease (dispose runs in a finally)', async () => {
    const m = manager();
    await expect(m.releaseRun('never-ran')).resolves.toBeUndefined();
    await step(m, 'run-1');
    await m.releaseRun('run-1');
    await expect(m.releaseRun('run-1')).resolves.toBeUndefined();
  });

  it('frees the profile mutex, so the NEXT run can take it', async () => {
    const m = manager();
    await step(m, 'run-1');
    let secondStarted = false;
    const second = step(m, 'run-2').then((p) => {
      secondStarted = true;
      return p;
    });
    await new Promise((r) => setTimeout(r, 10));
    // Run 2 must wait: one profile, one jar, one Chromium singleton.
    expect(secondStarted).toBe(false);
    await m.releaseRun('run-1');
    await expect(Promise.race([second, timeout(5_000)])).resolves.toBeDefined();
    await m.releaseRun('run-2');
  });
});

describe('THE IDLE BACKSTOP - a Cortex that dies must not leave an authenticated jar open', () => {
  it('reaps a run whose steps stopped arriving, and CLEARS its session', async () => {
    // The explicit release never comes if Cortex is killed mid-run. Without a backstop the injected
    // Cofre session stays resident in a jar the next automation on this profile inherits, and a
    // headed browser window stays open on somebody's desktop indefinitely.
    const m = manager({ runIdleMs: 30 });
    const page = await step(m, 'run-1', (p) => p.setUrl('https://portal.test/inbox'), SESSION);
    expect(m.openRuns()).toEqual(['run-1']);

    await waitFor(() => m.openRuns().length === 0, 5_000);
    expect(contexts[0]!.cleared).toBe(1);
    expect(page.closed).toBe(true);
  });

  it('does NOT reap a run whose step is still in flight - the window bounds IDLE, not duration', async () => {
    const m = manager({ runIdleMs: 30 });
    await step(m, 'run-1');
    await m.withRunLease({ runId: 'run-1', profileId: 'acme' }, async (lease) => {
      // A slow step: many times longer than the whole idle window.
      await new Promise((r) => setTimeout(r, 300));
      const page = (await lease.page()) as FakePage;
      expect(page.closed).toBe(false);
      return page;
    });
    // Still healthy the instant the slow step ended.
    expect(contexts[0]!.cleared).toBe(0);
    await m.releaseRun('run-1');
  });

  it('each step RE-ARMS the window, so a run LONGER than the window is never reaped mid-flight', async () => {
    // The run's TOTAL length (8 x 40ms = 320ms+) deliberately exceeds the window (200ms), while
    // every individual gap sits well inside it. A backstop that armed once and never re-armed would
    // reap this run halfway through - which is the point: the window bounds the gap between steps,
    // not how long a run may take.
    const m = manager({ runIdleMs: 200 });
    const first = await step(m, 'run-1');
    const startedAt = Date.now();
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 40));
      const page = await step(m, 'run-1');
      expect(page.id, `step ${i} got a different page - the run was reaped mid-flight`).toBe(first.id);
    }
    expect(Date.now() - startedAt).toBeGreaterThan(200);
    expect(contexts[0]!.cleared).toBe(0);
    expect(m.openRuns()).toEqual(['run-1']);
    await m.releaseRun('run-1');
  });

  it('REFUSES a step that arrives after the reap rather than serving it a blank page', async () => {
    // Handing a late invoke a fresh lease would restore the original defect under a new cause: a
    // brand-new about:blank with an empty jar, reported to Cortex as a step that ran.
    const m = manager({ runIdleMs: 30 });
    await step(m, 'run-1', undefined, SESSION);
    await waitFor(() => m.openRuns().length === 0, 5_000);

    await expect(step(m, 'run-1')).rejects.toThrow(/inactividade/);
    expect(contexts[0]!.openPages).toHaveLength(1); // no second page was ever opened
  });

  it('REFUSES a step that arrives after the explicit release too', async () => {
    const m = manager();
    await step(m, 'run-1');
    await m.releaseRun('run-1');
    await expect(step(m, 'run-1')).rejects.toThrow(/já foi encerrada/);
  });

  it('bounds the tombstone list rather than remembering every run forever', async () => {
    const m = manager();
    for (let i = 0; i < 250; i++) await m.releaseRun(`run-${i}`);
    // The oldest are evicted, so an ancient runId is servable again; the recent ones stay refused.
    await expect(step(m, 'run-0')).resolves.toBeDefined();
    await m.releaseRun('run-0');
    await expect(step(m, 'run-249')).rejects.toThrow(/já foi encerrada/);
  });
});

describe('the stale SingletonLock recovery, against the lock real Chrome actually leaves', () => {
  it('clears a DANGLING SYMLINK lock - existsSync reports false for it and skipped it', async () => {
    // Real Chrome does not write SingletonLock as a file. It writes a SYMLINK whose target is
    // "<hostname>-<pid>" - a name that never exists on disk. `existsSync` FOLLOWS the link, so it
    // returned false for exactly the lock a crashed Chrome leaves, `continue`d, and the recovery
    // was dead code against the browser it was written for. lstat does not follow.
    const dir = join(home, 'profiles', 'acme');
    mkdirSync(dir, { recursive: true });
    symlinkSync('somehost-31337', join(dir, 'SingletonLock'));
    symlinkSync('somehost-31337', join(dir, 'SingletonSocket'));
    expect(existsSync(join(dir, 'SingletonLock'))).toBe(false); // the whole problem, in one line
    expect(() => lstatSync(join(dir, 'SingletonLock'))).not.toThrow();

    const m = manager();
    await step(m, 'run-1');
    await m.releaseRun('run-1');

    expect(() => lstatSync(join(dir, 'SingletonLock'))).toThrow();
    expect(() => lstatSync(join(dir, 'SingletonSocket'))).toThrow();
  });

  it('still clears an ordinary FILE lock (the bundled-chromium shape)', async () => {
    const dir = join(home, 'profiles', 'acme');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SingletonLock'), 'stale');
    const m = manager();
    await step(m, 'run-1');
    await m.releaseRun('run-1');
    expect(existsSync(join(dir, 'SingletonLock'))).toBe(false);
  });

  it('NEVER deletes the lock of a browser this process is running', async () => {
    // The context stays warm between runs. A sweep at that point would delete the SingletonLock of
    // a live Chrome and corrupt the profile under it.
    const m = manager();
    await step(m, 'run-1');
    await m.releaseRun('run-1');
    const dir = join(home, 'profiles', 'acme');
    symlinkSync('somehost-999', join(dir, 'SingletonLock'));
    await step(m, 'run-2'); // reuses the warm context - must NOT sweep
    await m.releaseRun('run-2');
    expect(() => lstatSync(join(dir, 'SingletonLock'))).not.toThrow();
    expect(launches).toHaveLength(1);
  });
});

describe('idle-close of the CONTEXT waits for the close before relaunching', () => {
  it('does not sweep and relaunch while the old context is still closing', async () => {
    // The entry used to be deleted from `held` BEFORE `context.close()` resolved, so the map said
    // "nothing here" while Chromium was still shutting down: the next acquire swept the singleton
    // markers of a live browser and launched into the collision.
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      openGate = r;
    });
    const m = manager({ idleCloseMs: 10 });
    await step(m, 'run-1');
    contexts[0]!.closeGate = gate;
    await m.releaseRun('run-1');

    await waitFor(() => contexts[0]!.closeStarted === 1, 5_000);
    expect(contexts[0]!.closed).toBe(false); // close is in flight, blocked on the gate

    let relaunched = false;
    const next = step(m, 'run-2').then((p) => {
      relaunched = true;
      return p;
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(relaunched).toBe(false);
    expect(launches).toHaveLength(1); // NOT launched behind the closing browser

    openGate();
    await expect(Promise.race([next, timeout(5_000)])).resolves.toBeDefined();
    expect(contexts[0]!.closed).toBe(true);
    expect(launches).toHaveLength(2);
    await m.releaseRun('run-2');
  });
});

describe('SHUTDOWN IS FINAL', () => {
  it('refuses a queued acquire that wakes AFTER closeAll instead of launching a new browser', async () => {
    // `acquire` checked `closed` at its top and then awaited the per-profile chain - which can be a
    // whole run long. `ensureContext` never re-checked, so a waiter that woke after shutdown
    // launched a fresh HEADED browser the daemon was in the middle of tearing down.
    const m = manager();
    await step(m, 'run-1'); // run 1 holds the profile
    const queued = step(m, 'run-2'); // queues behind it
    const settled = queued.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );

    await m.closeAll();
    await m.releaseRun('run-1'); // frees the chain; the waiter wakes into a closed manager

    await expect(settled).resolves.toBe('rejected');
    expect(launches).toHaveLength(1);
  });

  it('closeAll releases live runs BEFORE closing their context, so no session is left on disk', async () => {
    // Closing the context underneath a held lease would drop the jar without clearing it - and on a
    // PERSISTENT profile the cookies are on disk, so the session would survive the daemon.
    const m = manager();
    await step(m, 'run-1', undefined, SESSION);
    await m.closeAll();
    expect(contexts[0]!.cleared).toBe(1);
    expect(contexts[0]!.closed).toBe(true);
    expect(m.openRuns()).toEqual([]);
  });

  it('refuses a NEW run after shutdown', async () => {
    const m = manager();
    await m.closeAll();
    await expect(step(m, 'run-1')).rejects.toThrow(/encerrado/);
  });
});

function timeout(ms: number): Promise<never> {
  return new Promise((_r, reject) => setTimeout(() => reject(new Error('timed out')), ms));
}

async function waitFor(predicate: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('condition never held');
}
