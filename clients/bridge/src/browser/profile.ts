/**
 * browser/profile.ts - the daemon's OWN persistent headed Chrome profiles (P1.1).
 *
 * WHAT A PROFILE IS FOR, AND WHAT IT IS NOT FOR. The profile supplies DEVICE realness: a real
 * installed Chrome, a real user-data directory that accumulates the ordinary residue of a browser
 * that has been used before (fonts, GPU cache, a stable client hint surface), a normal window on a
 * real display. It does NOT supply the SESSION. Sessions arrive per run from the Cofre and are
 * cleared at run end, so a credential is never left resident in a jar two runs share. Those are
 * different lifetimes and conflating them is how a "temporary" login becomes permanent.
 *
 * IT IS NEVER THE USER'S OWN CHROME PROFILE. `userDataDir` lives under `<EKOA_BRIDGE_HOME>/profiles/`
 * at mode 0700 and nowhere else. Pointing this at `~/Library/Application Support/Google/Chrome`
 * would hand every automation the user's whole browsing identity - every site they are signed into,
 * their history, their saved passwords - and would also make the automation and the human fight
 * over the same singleton lock. The isolation is the point, not a limitation.
 *
 * REALNESS IS HYGIENE, NOT A STEALTH STACK. `channel: 'chrome'` (falling back to bundled chromium
 * when Chrome is absent), a headed window, the host locale/timezone, a normal viewport,
 * `--disable-blink-features=AutomationControlled`, and one init script removing the
 * `navigator.webdriver` tell. That is the whole list, deliberately: it removes the artificial
 * signals THIS tool introduces. It is not a fingerprint-spoofing project, and building one here
 * would be a different product with a different failure mode (a spoof that is itself detectable).
 *
 * LOCKING IS LOAD-BEARING. Chromium refuses a second launch against a live `userDataDir` (the
 * SingletonLock), so two runs on one profile MUST serialize rather than race. A per-`profileId`
 * async mutex does that: a second acquire QUEUES; distinct profileIds are fully concurrent. The
 * cross-process case is already bounded - `serve.ts` refuses to start a second daemon on the same
 * home via the pidfile (verified, `cli/commands/serve.ts`) - so the only contender for a
 * `userDataDir` is this process, and an in-process mutex is sufficient. A crash still leaves a
 * stale lock behind, so acquire clears one when no live context is held.
 *
 * THE LEASE IS SCOPED TO A RUN, NOT TO A STEP. This is the whole point and it was wrong before.
 * Cortex dispatches ONE `tool.invoke` PER ACTION - `DaemonBrowserSession.dispatch` is reached from
 * every `act()`, `assert()` and `observe()` - and the executor used to acquire a lease per FRAME
 * and release it in a `finally`. Release closes the run's page and clears the whole cookie jar, so
 * a navigate landed, the page closed, the jar was wiped, and the next click ran on a fresh
 * `about:blank` with no cookies: EVERY browser step after the first acted on a blank page. A
 * multi-step flow - which is the entire point of a browser capability - could not work.
 *
 * So the lease is now keyed by `runId` (`withRunLease`): one page and one jar alive across every
 * invoke of one run, and the teardown hangs off the END OF THE RUN. Two things end a run, and both
 * have to exist:
 *
 *   1. EXPLICIT. Cortex sends the `release` browser verb from `DaemonBrowserSession.dispose()`,
 *      which the engine calls in its run `finally`. This is the normal path and it is prompt.
 *   2. IDLE BACKSTOP (`RUN_IDLE_MS`). If Cortex dies, is killed, or its socket drops mid-run, the
 *      explicit release never arrives - and an idle-free design would then leave a HEADED browser
 *      window open on somebody's desktop and, worse, an AUTHENTICATED Cofre session resident in a
 *      jar that the next run of any automation on this profile inherits. The backstop is a security
 *      control before it is hygiene: it is the upper bound on how long an injected session can sit
 *      in the jar with nobody driving it.
 *
 * WHY TWO MINUTES. The window has to sit above the largest legitimate gap between two consecutive
 * invokes of one run and as far below that as it can. The gap is hosted-side think time: a step's
 * cache miss goes out to the vision resolver, then the verifier, then possibly the rehearsal fixer -
 * several model round trips - while Cortex's own per-invocation timeout is two minutes (the daemon
 * runtime's own comment names it). Anything under about a minute would reap live runs during a slow
 * vision escalation; anything much over two minutes is just a longer time for an authenticated jar
 * to sit unattended, and buys nothing, because a Cortex that has not spoken for two minutes has
 * already blown its own invocation budget. The timer is armed AFTER each step completes, never
 * during one, so a slow step is never reaped out from under itself.
 *
 * A REAPED RUN IS REFUSED, NOT SILENTLY RESTARTED. If a late invoke arrived for a run the backstop
 * already reaped, acquiring a fresh lease for it would recreate the exact bug this file exists to
 * fix - a blank page and an empty jar, reported as success. The runId is tombstoned instead and the
 * step fails by name.
 */
import { chmodSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type {
  PersistentLaunchOptions,
  PersistentLauncher,
  ProfileContext,
  ProfileCookie,
  ProfilePage,
} from './types.js';

/** Chromium's singleton markers. A crashed run leaves these behind and blocks the next launch. */
const SINGLETON_MARKERS = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];

/** A window a human would not look twice at. Matches the hosted default so a cached action
 *  resolved against one viewport replays against the same one. */
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

const LAUNCH_TIMEOUT_MS = 60_000;

/** How long an idle profile context stays open before it is closed. Long enough that a run every
 *  few minutes keeps a warm profile; short enough that an abandoned daemon is not holding a
 *  visible browser window open forever. Measured from the moment NO run holds the profile. */
const IDLE_CLOSE_MS = 10 * 60_000;

/**
 * How long a RUN may hold its lease with no step arriving before the daemon reaps it. See the file
 * header for the derivation: above one hosted vision escalation, at Cortex's own per-invocation
 * timeout, and no higher - because for this whole window an injected Cofre session is resident in
 * the jar with nobody driving it.
 */
const RUN_IDLE_MS = 2 * 60_000;

/** How many reaped runIds are remembered so a late invoke is refused by name rather than served a
 *  blank page. Bounded: it is a tombstone list, not a run history. */
const MAX_ENDED_RUNS = 200;

/**
 * The one init script. It removes the tell Playwright itself adds; it does not attempt to emulate
 * a browser this is not. Written as a plain string because the daemon compiles without DOM types.
 */
export const WEBDRIVER_INIT_SCRIPT =
  "try{Object.defineProperty(Object.getPrototypeOf(navigator),'webdriver',{get:()=>undefined,configurable:true});}catch(e){}" +
  "try{delete navigator.webdriver;}catch(e){}";

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

/** The session to wear for ONE run. Cookies land on the context; `origins` seed localStorage on
 *  first navigation to each origin (a persistent context cannot be handed a `storageState`). */
export interface ProfileSession {
  cookies: ProfileCookie[];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

/**
 * Pull the cookie list and the origins list out of whatever the Cofre stored. Accepts both shapes
 * the capture half produces: a raw Playwright `storageState` and the `{ storageState, capturedAt }`
 * wrapper. Entries missing what `addCookies` needs are DROPPED rather than failing the run - a
 * best-effort injection degrades to "not signed in", which the run can still report honestly.
 * Cookie names and values are never logged by any caller.
 */
export function parseSessionState(raw: unknown): ProfileSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const inner =
    obj.storageState && typeof obj.storageState === 'object' ? (obj.storageState as Record<string, unknown>) : obj;

  const cookies: ProfileCookie[] = [];
  if (Array.isArray(inner.cookies)) {
    for (const c of inner.cookies) {
      if (!c || typeof c !== 'object') continue;
      const cookie = c as Record<string, unknown>;
      if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string') continue;
      if (typeof cookie.domain !== 'string' && typeof cookie.url !== 'string') continue;
      cookies.push(cookie as unknown as ProfileCookie);
    }
  }

  const origins: ProfileSession['origins'] = [];
  if (Array.isArray(inner.origins)) {
    for (const o of inner.origins) {
      if (!o || typeof o !== 'object') continue;
      const entry = o as Record<string, unknown>;
      if (typeof entry.origin !== 'string') continue;
      const items: Array<{ name: string; value: string }> = [];
      if (Array.isArray(entry.localStorage)) {
        for (const kv of entry.localStorage) {
          if (!kv || typeof kv !== 'object') continue;
          const pair = kv as Record<string, unknown>;
          if (typeof pair.name === 'string' && typeof pair.value === 'string') {
            items.push({ name: pair.name, value: pair.value });
          }
        }
      }
      origins.push({ origin: entry.origin, localStorage: items });
    }
  }

  if (cookies.length === 0 && origins.length === 0) return null;
  return { cookies, origins };
}

/**
 * A profile held for the duration of ONE run. Nobody else can launch this `userDataDir` until
 * `release()` runs, and release is what guarantees the session does not outlive the run.
 */
export interface ProfileLease {
  readonly profileId: string;
  readonly userDataDir: string;
  readonly context: ProfileContext;
  /** The run's page, created on first use and closed on release. */
  page(): Promise<ProfilePage>;
  /**
   * Seed the CURRENT page's origin from the injected session's localStorage, once per origin.
   * Called by the executor after a navigation: a persistent context has no `storageState` option,
   * and an init script cannot be removed afterwards, so seeding happens per page-origin and is
   * undone by `release()`.
   */
  seedStorageForCurrentOrigin(page: ProfilePage): Promise<void>;
  /** Close the run's pages, CLEAR the injected session, and free the profile for the next run. */
  release(): Promise<void>;
}

export interface ProfileManagerDeps {
  /** `EKOA_BRIDGE_HOME`. Profiles live under `<home>/profiles/`, never anywhere else. */
  home: string;
  /** Injected for tests so no unit test needs a real Chrome. Default: Playwright chromium. */
  launch?: PersistentLauncher;
  /** User-visible progress in Portuguese; a headed window opens in front of somebody. */
  log?: (message: string) => void;
  now?: () => number;
  /** Idle-close window for an UNHELD context; 0 disables the timer (tests). */
  idleCloseMs?: number;
  /**
   * Idle backstop for a RUN's lease; 0 disables it (tests that drive the lifecycle by hand).
   * Distinct from `idleCloseMs`: that one bounds a warm context nobody holds, this one bounds an
   * authenticated session a run left resident. Default `RUN_IDLE_MS`.
   */
  runIdleMs?: number;
}

interface HeldProfile {
  context: ProfileContext;
  userDataDir: string;
  idleTimer?: ReturnType<typeof setTimeout>;
  /**
   * Set the moment the idle backstop STARTS closing this context, and cleared only when the close
   * has resolved. `ensureContext` awaits it before it sweeps singleton markers and relaunches:
   * dropping the map entry first (which is what this replaces) let the next acquire delete the
   * SingletonLock of a browser that was still shutting down and then launch into the collision.
   */
  closing?: Promise<void>;
}

/** One run's hold on a profile: the lease itself plus the bookkeeping the idle backstop needs. */
interface RunHold {
  /** The profile key this run took. A run that somehow targets a different profile releases the
   *  first before taking the second, rather than silently holding two. */
  profileKey: string;
  /** Resolves to the run's lease. Held as the PROMISE so a release that arrives mid-acquire can
   *  wait for the acquire it is cancelling instead of racing it. */
  lease: Promise<ProfileLease>;
  /** Steps currently executing against this lease. The backstop never reaps a busy run. */
  busy: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Owns every persistent profile this daemon runs. One instance per daemon process.
 */
export class ProfileManager {
  private readonly held = new Map<string, HeldProfile>();
  /** Per-profileId serialisation chain - INDEPENDENT of `held` so a queued acquire survives a
   *  context that was idle-closed between the two. */
  private readonly chains = new Map<string, Promise<void>>();
  /** runId -> the lease that run holds. THE run-scoped lease: one entry per live run. */
  private readonly runs = new Map<string, RunHold>();
  /**
   * runIds whose lease is gone, and why. A step arriving for one of these is REFUSED: quietly
   * handing it a fresh lease would restore the blank-page-every-step bug under a different cause.
   * Bounded FIFO - a Map iterates in insertion order, so the oldest key is the one to evict.
   */
  private readonly endedRuns = new Map<string, 'idle' | 'released'>();
  private closed = false;

  constructor(private readonly deps: ProfileManagerDeps) {}

  /** `<home>/profiles/<profileId>`, created 0700. Exposed so tests can assert WHERE it lands. */
  userDataDirFor(profileId: string): string {
    return join(this.deps.home, 'profiles', sanitizeProfileId(profileId));
  }

  /**
   * Run ONE step against the run's lease, taking the lease on the first step of the run and KEEPING
   * it - the page, its cookies and its seeded localStorage - for every later step of the same run.
   * This is the API the executor uses; `acquire` below is the primitive underneath it.
   *
   * `session` is a THUNK because it is only consulted when the lease is actually taken. Resolving
   * the Cofre session again on every step would re-read credential material for a jar that already
   * carries it, and would also be a lie about lifetime: the session is injected ONCE per run.
   */
  async withRunLease<T>(
    input: { runId: string; profileId: string; session?: () => ProfileSession | null },
    fn: (lease: ProfileLease) => Promise<T>,
  ): Promise<T> {
    const hold = await this.holdForRun(input);
    hold.busy += 1;
    try {
      return await fn(await hold.lease);
    } finally {
      hold.busy -= 1;
      // Arm the backstop from the END of the step: a slow step must never be reaped mid-flight,
      // and the window is meant to bound IDLE time, not total time.
      this.armRunIdle(input.runId, hold);
    }
  }

  /**
   * END OF RUN. Drops the run's page and CLEARS the injected session out of the shared jar; the
   * profile context stays warm for the next run. Idempotent, and safe to call for a run that was
   * already reaped - Cortex's `dispose()` runs in a `finally` and must never throw out of it.
   */
  async releaseRun(runId: string, reason: 'idle' | 'released' = 'released'): Promise<void> {
    const hold = this.runs.get(runId);
    // Tombstone FIRST, and with the real reason, so a step racing the teardown is refused with the
    // message that names what actually happened. Tombstoned even when there is nothing to release:
    // the run is over either way, and a later step must be refused rather than handed a blank page.
    this.markRunEnded(runId, reason);
    if (!hold) return;
    this.runs.delete(runId);
    if (hold.idleTimer) clearTimeout(hold.idleTimer);
    const lease = await hold.lease.catch(() => null);
    await lease?.release().catch(() => undefined);
  }

  /** runIds currently holding a lease. For the status surface and tests. */
  openRuns(): string[] {
    return [...this.runs.keys()];
  }

  /**
   * Take the profile for one run. A second acquire for the SAME profileId queues behind the first
   * (the SingletonLock makes racing them a launch failure, not a race we could win); distinct
   * profileIds proceed concurrently.
   */
  async acquire(profileId: string, session?: ProfileSession | null): Promise<ProfileLease> {
    if (this.closed) throw new ProfileError('o gestor de perfis já foi encerrado');
    const key = sanitizeProfileId(profileId);

    // Install this acquire at the tail of the chain BEFORE awaiting the previous one, so two
    // synchronous callers cannot both see an empty chain and both proceed.
    let releaseHold: () => void = () => undefined;
    const myHold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const previous = this.chains.get(key) ?? Promise.resolve();
    this.chains.set(
      key,
      previous.then(
        () => myHold,
        () => myHold,
      ),
    );
    await previous;

    let context: ProfileContext;
    try {
      context = await this.ensureContext(key);
    } catch (err) {
      releaseHold();
      throw err;
    }

    const seeded = new Set<string>();
    let runPage: ProfilePage | null = null;
    let released = false;

    if (session && session.cookies.length > 0) {
      // Cookies must land before the first navigation so the very first request carries them.
      // A malformed payload degrades to "not signed in" rather than failing the run, and the
      // failure message is deliberately value-free (Playwright's own error quotes the cookie).
      try {
        await context.addCookies(session.cookies);
      } catch {
        this.deps.log?.(`Aviso: não foi possível aplicar a sessão guardada (${session.cookies.length} cookie(s)).`);
      }
    }

    const lease: ProfileLease = {
      profileId: key,
      userDataDir: this.userDataDirFor(key),
      context,
      page: async (): Promise<ProfilePage> => {
        if (runPage && !runPage.isClosed()) return runPage;
        runPage = await context.newPage();
        return runPage;
      },
      seedStorageForCurrentOrigin: async (page: ProfilePage): Promise<void> => {
        if (!session || session.origins.length === 0) return;
        const origin = originOf(page.url());
        if (!origin || seeded.has(origin)) return;
        const entry = session.origins.find((o) => normaliseOrigin(o.origin) === origin);
        seeded.add(origin); // mark BEFORE the write: one attempt per origin either way
        if (!entry || entry.localStorage.length === 0) return;
        try {
          await page.evaluate(buildStorageSeedScript(entry.localStorage));
        } catch {
          /* a page that navigated away mid-seed; the run continues without the seeded keys */
        }
      },
      release: async (): Promise<void> => {
        if (released) return;
        released = true;
        try {
          // Order matters: clear the SESSION while the context is still usable, then drop pages.
          // Doing it the other way round leaves the jar populated if a page close throws.
          await this.clearSession(context, session ?? null, seeded);
        } finally {
          if (runPage && !runPage.isClosed()) {
            await runPage.close().catch(() => undefined);
          }
          runPage = null;
          this.armIdleClose(key);
          releaseHold();
        }
      },
    };

    return lease;
  }

  /**
   * Close every open profile context (daemon shutdown). SHUTDOWN IS FINAL: `closed` is set first
   * and `ensureContext` refuses on it, so a queued acquire that wakes AFTER this point is refused
   * rather than served a brand-new headed browser the daemon is in the middle of shutting down.
   */
  async closeAll(): Promise<void> {
    this.closed = true;
    // Release live runs FIRST. Closing the context underneath a lease would drop the jar without
    // clearing it, which on a persistent profile means the injected session survives on DISK.
    for (const runId of [...this.runs.keys()]) {
      await this.releaseRun(runId).catch(() => undefined);
    }
    const contexts = [...this.held.values()];
    this.held.clear();
    for (const h of contexts) {
      if (h.idleTimer) clearTimeout(h.idleTimer);
      // A context the backstop is already closing is awaited rather than closed twice.
      await (h.closing ?? h.context.close().catch(() => undefined));
    }
  }

  /** Open profileIds, for the status surface and tests. */
  openProfiles(): string[] {
    return [...this.held.keys()];
  }

  // --- internals ------------------------------------------------------------

  /**
   * The run's hold, taken on its first step. A run that already holds one gets it back untouched -
   * same page, same cookies - which is the whole point of the run scope.
   */
  private async holdForRun(input: {
    runId: string;
    profileId: string;
    session?: () => ProfileSession | null;
  }): Promise<RunHold> {
    if (this.closed) throw new ProfileError('o gestor de perfis já foi encerrado');
    const key = sanitizeProfileId(input.profileId);

    const existing = this.runs.get(input.runId);
    if (existing) {
      if (existing.profileKey === key) return existing;
      // A run that changes profile mid-flight. Give the first one back (which clears its session)
      // before taking the second, rather than holding two profiles for one run.
      await this.releaseRun(input.runId);
      this.endedRuns.delete(input.runId);
    }

    const ended = this.endedRuns.get(input.runId);
    if (ended) {
      // Serving this would mean a fresh page and an empty jar reported as a working step - exactly
      // the failure the run-scoped lease exists to remove. Fail by name instead.
      throw new ProfileError(
        ended === 'idle'
          ? 'a sessão de navegador desta execução expirou por inactividade e foi encerrada nesta máquina'
          : 'a sessão de navegador desta execução já foi encerrada',
      );
    }

    const lease = this.acquire(key, input.session?.() ?? null);
    const hold: RunHold = { profileKey: key, lease, busy: 0 };
    this.runs.set(input.runId, hold);
    // A failed acquire must not leave a poisoned hold behind: the next step should be free to try
    // again (a launch can fail transiently), and awaiting a rejected promise twice is not a retry.
    lease.catch(() => {
      if (this.runs.get(input.runId) === hold) this.runs.delete(input.runId);
    });
    await lease;
    return hold;
  }

  /**
   * The idle backstop. Reaps a run whose lease has sat unused for `runIdleMs` - the case where
   * Cortex died and the explicit `release` will never arrive. A BUSY run is never reaped; the timer
   * simply re-arms, because the window bounds idleness, not the length of a step.
   */
  private armRunIdle(runId: string, hold: RunHold): void {
    // The run may have been released while this step was running (`withRunLease` arms from its
    // `finally`). Arming a timer on a hold nobody owns leaves a timer with nothing to reap.
    if (this.runs.get(runId) !== hold) return;
    const idleMs = this.deps.runIdleMs ?? RUN_IDLE_MS;
    if (hold.idleTimer) {
      clearTimeout(hold.idleTimer);
      delete hold.idleTimer;
    }
    if (idleMs <= 0) return;
    const timer = setTimeout(() => {
      if (this.runs.get(runId) !== hold) return; // already released explicitly
      if (hold.busy > 0) {
        this.armRunIdle(runId, hold);
        return;
      }
      this.deps.log?.('A sessão de navegador de uma execução expirou por inactividade e foi encerrada.');
      void this.releaseRun(runId, 'idle').catch(() => undefined);
    }, idleMs);
    timer.unref?.();
    hold.idleTimer = timer;
  }

  /** Remember that a run ended, bounded. Insertion order is the eviction order. */
  private markRunEnded(runId: string, reason: 'idle' | 'released'): void {
    this.endedRuns.delete(runId);
    this.endedRuns.set(runId, reason);
    while (this.endedRuns.size > MAX_ENDED_RUNS) {
      const oldest = this.endedRuns.keys().next().value;
      if (oldest === undefined) break;
      this.endedRuns.delete(oldest);
    }
  }

  private async ensureContext(key: string): Promise<ProfileContext> {
    // Re-checked HERE and not only at the top of `acquire`: an acquire queued behind another run
    // can wait arbitrarily long on the per-profile chain, and `closeAll` can land in that gap. The
    // check at acquire-time alone let a waiter wake after shutdown and LAUNCH a headed browser the
    // daemon was tearing down.
    if (this.closed) throw new ProfileError('o gestor de perfis já foi encerrado');

    const existing = this.held.get(key);
    if (existing) {
      if (!existing.closing) {
        if (existing.idleTimer) {
          clearTimeout(existing.idleTimer);
          delete existing.idleTimer;
        }
        return existing.context;
      }
      // The idle backstop is closing this context right now. WAIT IT OUT before sweeping the
      // singleton markers and relaunching: sweeping while Chromium is still shutting down deletes
      // the lock of a live browser and the relaunch collides with the process that still holds the
      // userDataDir.
      await existing.closing;
      if (this.held.get(key) === existing) this.held.delete(key);
      if (this.closed) throw new ProfileError('o gestor de perfis já foi encerrado');
    }

    const userDataDir = this.userDataDirFor(key);
    mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
    // `recursive: true` does NOT apply the mode to a directory that already existed, and a profile
    // dir holds live cookies - so the mode is asserted every time rather than only at creation.
    try {
      chmodSync(userDataDir, 0o700);
    } catch {
      /* a filesystem without POSIX modes (a Windows volume); the directory is still private to the user */
    }
    this.clearStaleSingletonLock(key, userDataDir);

    const launch = this.deps.launch ?? defaultPersistentLaunch;
    const base: PersistentLaunchOptions = {
      headless: false,
      viewport: { ...DEFAULT_VIEWPORT },
      args: ['--disable-blink-features=AutomationControlled'],
      timeout: LAUNCH_TIMEOUT_MS,
      ...hostLocale(),
    };

    let context: ProfileContext;
    try {
      // Real installed Chrome first: it carries the real user-agent, the real TLS stack and the
      // real client hints. Bundled chromium is the honest fallback, not the preference.
      context = await launch(userDataDir, { ...base, channel: 'chrome' });
    } catch (err) {
      this.deps.log?.('Chrome não encontrado; a usar o navegador incluído.');
      try {
        context = await launch(userDataDir, base);
      } catch (second) {
        throw new ProfileError(
          `não foi possível abrir o navegador: ${second instanceof Error ? second.message : String(second)} (primeira tentativa: ${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }

    await context.addInitScript(WEBDRIVER_INIT_SCRIPT).catch(() => undefined);
    this.held.set(key, { context, userDataDir });
    return context;
  }

  /**
   * A crash leaves Chromium's singleton markers behind and every later launch fails on them.
   *
   * `lstat`, NOT `existsSync`. This is the difference between a recovery that works and dead code.
   * Real Chrome does not write `SingletonLock` as a file: it writes a SYMLINK whose target is
   * `<hostname>-<pid>`, a name that never exists on disk. `existsSync` FOLLOWS the link, so for the
   * dangling lock a crashed Chrome actually leaves it returns FALSE, the loop skipped it, and the
   * next launch died on the very marker this function exists to clear. `lstatSync` stats the link
   * itself. (The bundled chromium behaves differently enough that the unit lane, which never
   * launches a browser, could not have caught it - the test below builds the dangling link by hand.)
   *
   * NEVER a live lock. Deleting the SingletonLock of a running browser corrupts the profile under a
   * run in flight, so the sweep only happens when THIS process holds no context for the profile.
   * That is enforced TWICE, and honestly: the real enforcement is the caller - `ensureContext`
   * returns the warm context long before it reaches here, and reaches here after an idle close only
   * once it has awaited that close and dropped the entry. The `held` check below is belt-and-braces
   * for a destructive function, and it is currently UNREACHABLE through the public API (a mutation
   * removing it alone leaves the suite green; a mutation removing the caller's short-circuit turns
   * it red). It stays because the next call site added to this function should not have to
   * rediscover the invariant. The cross-process case is bounded elsewhere: `serve.ts` refuses a
   * second daemon on the same home via the pidfile.
   */
  private clearStaleSingletonLock(key: string, userDataDir: string): void {
    if (this.held.has(key)) return;
    for (const marker of SINGLETON_MARKERS) {
      const p = join(userDataDir, marker);
      try {
        lstatSync(p);
      } catch {
        continue; // genuinely absent (not merely a link whose target is)
      }
      try {
        rmSync(p, { force: true, recursive: false });
      } catch {
        /* not ours to remove; the launch below will report the real failure */
      }
    }
  }

  /**
   * Undo the run's session. Cookies go through `clearCookies` (the whole jar - the profile is the
   * daemon's own and holds nothing a run should keep); seeded localStorage keys are removed from
   * whatever pages are still open on those origins. A page already closed took its localStorage
   * with it only if the origin has no other page, so the removal is attempted, never assumed.
   */
  private async clearSession(
    context: ProfileContext,
    session: ProfileSession | null,
    seeded: Set<string>,
  ): Promise<void> {
    await context.clearCookies().catch(() => undefined);
    if (!session || seeded.size === 0) return;
    const pages = safePages(context);
    for (const page of pages) {
      if (page.isClosed()) continue;
      const origin = originOf(page.url());
      if (!origin || !seeded.has(origin)) continue;
      const entry = session.origins.find((o) => normaliseOrigin(o.origin) === origin);
      if (!entry || entry.localStorage.length === 0) continue;
      await page.evaluate(buildStorageClearScript(entry.localStorage)).catch(() => undefined);
    }
  }

  /**
   * Close a profile context nobody holds. The entry stays in `held`, marked `closing`, UNTIL the
   * close resolves - it used to be deleted first, which made the map say "no context here" while
   * Chromium was still shutting down. The next acquire then swept the singleton markers of a
   * browser that was still using them and launched straight into the collision. `ensureContext`
   * now awaits `closing` and only then relaunches.
   */
  private armIdleClose(key: string): void {
    const idleMs = this.deps.idleCloseMs ?? IDLE_CLOSE_MS;
    if (idleMs <= 0) return;
    const held = this.held.get(key);
    if (!held) return;
    if (held.idleTimer) clearTimeout(held.idleTimer);
    const timer = setTimeout(() => {
      const current = this.held.get(key);
      if (!current || current !== held || current.closing) return;
      const closing = current.context.close().catch(() => undefined);
      current.closing = closing;
      void closing.then(() => {
        // Only drop the entry if it is still the one that was closed.
        if (this.held.get(key) === current) this.held.delete(key);
      });
    }, idleMs);
    timer.unref?.();
    held.idleTimer = timer;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * A profileId is an integration/origin key chosen hosted-side, so it is attacker-influenced text
 * that becomes a DIRECTORY NAME. Everything outside a conservative alphabet is folded to `-`, which
 * makes traversal (`../`) and absolute paths structurally impossible rather than merely checked.
 */
export function sanitizeProfileId(profileId: string): string {
  const trimmed = (profileId ?? '').trim();
  const safe = trimmed.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '').slice(0, 100);
  return safe.length > 0 ? safe : 'default';
}

function safePages(context: ProfileContext): ProfilePage[] {
  try {
    return context.pages();
  } catch {
    return [];
  }
}

function hostLocale(): { locale?: string; timezoneId?: string } {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    return {
      ...(resolved.locale ? { locale: resolved.locale } : {}),
      ...(resolved.timeZone ? { timezoneId: resolved.timeZone } : {}),
    };
  } catch {
    return {};
  }
}

function normaliseOrigin(value: string): string {
  const trimmed = value.trim();
  return originOf(trimmed.includes('://') ? trimmed : `https://${trimmed}`) ?? trimmed;
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** localStorage writes, as a script string (no DOM lib in this compilation). */
function buildStorageSeedScript(items: Array<{ name: string; value: string }>): string {
  const pairs = JSON.stringify(items);
  return `(()=>{try{const items=${pairs};for(const it of items){localStorage.setItem(it.name,it.value);}}catch(e){}})()`;
}

/** …and their removal, so the run's session does not outlive the run. */
function buildStorageClearScript(items: Array<{ name: string; value: string }>): string {
  const names = JSON.stringify(items.map((i) => i.name));
  return `(()=>{try{const names=${names};for(const n of names){localStorage.removeItem(n);}}catch(e){}})()`;
}

/**
 * Playwright's persistent context, HEADED. Imported dynamically so the module graph does not pull
 * Playwright into a daemon that never runs a browser step.
 */
const defaultPersistentLaunch: PersistentLauncher = async (userDataDir, opts) => {
  const { chromium } = await import('playwright');
  return (await chromium.launchPersistentContext(userDataDir, opts as never)) as unknown as ProfileContext;
};
