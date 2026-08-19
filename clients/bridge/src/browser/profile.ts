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
 * So the lease is now keyed by a LEASE ID (`withRunLease`): one page and one jar alive across every
 * invoke that names it, and the teardown hangs off the end of the lease.
 *
 * THE KEY IS A LEASE ID AND NOT THE RUN ID, and that is not cosmetic. Cortex mints one lease id per
 * execution PASS and threads it down the call tree, so:
 *   - a SUB-AUTOMATION (its own runId, same owner, therefore the same profile) is the SAME tenant of
 *     its parent's lease. Keyed by runId it would instead queue behind a lease its parent holds for
 *     the whole parent run, while the parent waits for the child: a deadlock on the most ordinary
 *     composition in the product. It also means the child continues on the page its parent left
 *     open, which is what a sub-automation should do anyway.
 *   - a RESUMED run (needs_credentials -> the user unlocks -> the run continues under the SAME
 *     runId) arrives with a NEW lease id, so it takes a clean lease instead of colliding with the
 *     tombstone the previous pass left.
 *
 * THREE THINGS END A LEASE, and all three have to exist:
 *
 *   1. EXPLICIT. Cortex sends `leaseOp:'release'` from the engine's run `finally`. The normal path,
 *      and the prompt one.
 *   2. IDLE BACKSTOP (`RUN_IDLE_MS`). If Cortex dies, is killed, or its socket drops mid-run, the
 *      explicit release never arrives - and an idle-free design would then leave a HEADED browser
 *      window open on somebody's desktop and, worse, an AUTHENTICATED Cofre session resident in a
 *      jar that the next run of any automation on this profile inherits. The backstop is a security
 *      control before it is hygiene: it is the upper bound on how long an injected session can sit
 *      in the jar with nobody driving it.
 *   3. SHUTDOWN. `closeAll` releases live leases BEFORE closing their contexts, because the profile
 *      is persistent and closing the context underneath a lease would leave the session ON DISK.
 *
 * WHY TWO MINUTES, AND WHY A KEEPALIVE MAKES THAT HONEST. The window bounds how long an
 * authenticated jar may sit with nobody driving it, so it wants to be short. But a LIVE run can
 * legitimately go minutes without a browser step: it is blocked on a sub-automation, on a slow API
 * call, or on a human solving a CAPTCHA in that very window (`pause_for_user` deliberately has no
 * timeout - the user decides how long they need). A pure timer cannot tell those from an abandoned
 * lease, so it would have to be either uselessly long or wrong, and "wrong" here means reaping the
 * browser out from under somebody mid-CAPTCHA. Cortex therefore heartbeats every live lease
 * (`leaseOp:'keepalive'`), and the window is what bounds SILENCE from a Cortex that is still there.
 * Two minutes is several heartbeats' worth of tolerance and matches Cortex's own per-invocation
 * timeout: a Cortex that has not spoken in two minutes has already blown its own budget. The timer
 * is armed AFTER each step completes, never during one, so a slow step is never reaped mid-flight.
 *
 * A REAPED LEASE IS REFUSED, NOT SILENTLY RESTARTED. If a late invoke arrives for a lease the
 * backstop already reaped, handing it a fresh one would recreate the exact bug this file exists to
 * fix - a blank page and an empty jar, reported as success. The lease id is tombstoned instead and
 * the step fails by name.
 *
 * THE WIPE IS NOT ALLOWED TO FAIL QUIETLY. Releasing a lease is the ONE moment a whole run's
 * injected session is cleared out of a jar that outlives it. A `catch(() => undefined)` there would
 * mean a failed wipe leaves an authenticated session resident on disk while Cortex is told the run
 * ended cleanly - the worst combination available. So `releaseRun` drops its bookkeeping, and then
 * THROWS, and the executor turns that into a failed step on the wire.
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
 * How long a lease may go with NOTHING arriving for it - no step, no keepalive - before the daemon
 * reaps it. See the file header for the derivation: it bounds silence from a Cortex that is still
 * alive (which heartbeats), not the length of a run, and for this whole window an injected Cofre
 * session is resident in the jar with nobody driving it.
 */
const RUN_IDLE_MS = 2 * 60_000;

/** How many ended lease ids are remembered so a late invoke is refused by name rather than served a
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

/** Why a lease is no longer live. Carried on the tombstone so a late step is refused by the reason
 *  that actually applies, not by a generic one. */
type LeaseEnd = 'idle' | 'released';

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

/** One lease's hold on a profile: the lease itself plus the bookkeeping the idle backstop needs. */
interface RunHold {
  /**
   * The profile key this lease took, and the SCOPE of every later operation naming it. A `release`
   * or `keepalive` arriving under a different owner - hence a different profile - is refused rather
   * than served: `runs` is a process-wide map, and without this check a frame naming owner A could
   * end a lease belonging to owner B by guessing its id. Every page verb is already owner-scoped by
   * construction (it resolves a profile and acts on that profile's page); this is what makes the
   * lifecycle verbs no weaker than the verbs they end.
   */
  profileKey: string;
  /** Resolves to the lease. Held as the PROMISE so a release that arrives mid-acquire can wait for
   *  the acquire it is cancelling instead of racing it. */
  lease: Promise<ProfileLease>;
  /** Steps currently executing against this lease. The backstop never reaps a busy lease. */
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
  /** leaseId -> the hold it has on a profile. One entry per live lease (see the file header for why
   *  the key is a lease id and not a runId). */
  private readonly runs = new Map<string, RunHold>();
  /**
   * lease ids that are gone, and why. A step arriving for one of these is REFUSED: quietly handing
   * it a fresh lease would restore the blank-page-every-step bug under a different cause.
   * Bounded FIFO - a Map iterates in insertion order, so the oldest key is the one to evict.
   */
  private readonly endedRuns = new Map<string, LeaseEnd>();
  /**
   * leaseId -> what to drop when that lease ends (slice P2.2).
   *
   * Registered BY THE MODULE THAT CREATES THE THING, not wired at the composition root, because
   * "who cleans this up" and "who made it" must not be two different files - the first version of
   * the network recorder was disposed only by the frame handler, and the two routes that send no
   * frame (the idle backstop, `closeAll`) left it resident with live header values in it.
   */
  private readonly leaseEndHooks = new Map<string, () => void>();
  private closed = false;

  constructor(private readonly deps: ProfileManagerDeps) {}

  /** `<home>/profiles/<profileId>`, created 0700. Exposed so tests can assert WHERE it lands. */
  userDataDirFor(profileId: string): string {
    return join(this.deps.home, 'profiles', sanitizeProfileId(profileId));
  }

  /**
   * REGISTER A PER-LEASE HOLDING to be dropped when the lease ends - by ANY of the three routes.
   *
   * `releaseRun` is the one funnel: the explicit end-of-run frame, the idle backstop and `closeAll`
   * at shutdown all go through it. One hook per lease; re-registering replaces it, so an arm/re-arm
   * cycle cannot stack callbacks.
   */
  onLeaseEnd(leaseId: string, drop: () => void): void {
    this.leaseEndHooks.set(leaseId, drop);
  }

  /** Fire and forget this lease's hook, once. A throwing hook is reported, never propagated: a
   *  lease ends whether or not its cleanup liked it. */
  private fireLeaseEnd(leaseId: string): void {
    const drop = this.leaseEndHooks.get(leaseId);
    if (!drop) return;
    this.leaseEndHooks.delete(leaseId);
    try {
      drop();
    } catch (err) {
      this.deps.log?.(`aviso: a limpeza do fim de sessão falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Run ONE step against a lease, taking the lease on the first step that names it and KEEPING it -
   * the page, its cookies and its seeded localStorage - for every later step that names the same
   * id. This is the API the executor uses; `acquire` below is the primitive underneath it.
   *
   * `session` is a THUNK because it is only consulted when the lease is actually taken. Resolving
   * the Cofre session again on every step would re-read credential material for a jar that already
   * carries it, and would also be a lie about lifetime: the session is injected ONCE per lease.
   */
  async withRunLease<T>(
    input: { leaseId: string; profileId: string; session?: () => ProfileSession | null },
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
      this.armRunIdle(input.leaseId, hold);
    }
  }

  /**
   * THE RUN IS STILL ALIVE - the keepalive. Re-arms the idle backstop for a lease nobody is driving
   * at this instant, which is the ordinary state of a run blocked on a sub-automation, on a slow
   * API call, or on a human at a CAPTCHA in that very window.
   *
   * Answers whether the lease is still held, so Cortex is told the truth rather than silently
   * heartbeating something that no longer exists. Never creates a lease: a keepalive means "keep
   * what I have", and inventing a page and an empty jar in response to one would be exactly the
   * silent-blank-page failure this file exists to remove.
   */
  touchRun(leaseId: string, opts: { profileId?: string } = {}): boolean {
    const hold = this.runs.get(leaseId);
    if (!hold) return false;
    this.assertScope(hold, opts.profileId);
    this.armRunIdle(leaseId, hold);
    return true;
  }

  /**
   * END OF LEASE. Drops the page and CLEARS the injected session out of the shared jar; the profile
   * context stays warm for the next run. Idempotent, and safe to call for a lease that was already
   * reaped - the engine calls this from a run `finally`.
   *
   * IT THROWS WHEN THE WIPE FAILS, and that is the whole reason it is written this way. This call
   * is the single moment a whole run's authenticated session leaves a jar that outlives it. If it
   * swallowed the failure the daemon would answer `ok:true`, the run record would say the run ended
   * cleanly, and an injected Cofre session would stay resident in a profile the user's next
   * automation shares. A failed wipe is a security event and has to reach the wire. The bookkeeping
   * (map entry, timer, tombstone) is dropped BEFORE the wipe is attempted, so a throw leaves no
   * half-live lease behind: the lease is over either way, what failed is the cleanup.
   */
  async releaseRun(
    leaseId: string,
    opts: { reason?: LeaseEnd; profileId?: string } = {},
  ): Promise<void> {
    const hold = this.runs.get(leaseId);
    if (!hold) {
      // Nothing to release. An EXISTING tombstone is refreshed with the newer reason (a release
      // arriving after the backstop already reaped the lease is the ordinary case), but a lease id
      // this machine has never seen does NOT get one: minting a tombstone from an unknown id would
      // let a frame pre-refuse a lease that has not started yet, and the scope check has nothing to
      // check it against. A release for a lease that was never taken is simply a no-op.
      if (this.endedRuns.has(leaseId)) this.markRunEnded(leaseId, opts.reason ?? 'released');
      return;
    }
    this.assertScope(hold, opts.profileId);
    const reason = opts.reason ?? 'released';
    // ANYTHING WHOSE LIFETIME IS THIS LEASE GOES NOW, and it goes on ALL THREE end routes because
    // they all land here: the explicit frame, the idle backstop, and `closeAll`. Fired BEFORE the
    // wipe is attempted, so even a release that throws cannot leave a per-lease holding behind.
    this.fireLeaseEnd(leaseId);
    // Tombstone FIRST, and with the real reason, so a step racing the teardown is refused with the
    // message that names what actually happened. A lease id belongs to ONE execution pass, so this
    // can never refuse a resumed run.
    this.markRunEnded(leaseId, reason);
    this.runs.delete(leaseId);
    if (hold.idleTimer) clearTimeout(hold.idleTimer);
    const lease = await hold.lease.catch(() => null);
    await lease?.release();
  }

  /** Lease ids currently holding a profile. For the status surface and tests. */
  openRuns(): string[] {
    return [...this.runs.keys()];
  }

  /**
   * A lifecycle verb may only touch a lease on the profile it names. `runs` is process-wide and a
   * lease id is just a string on the wire, so without this a frame carrying owner A and a lease id
   * belonging to owner B would end B's run. `profileId` is omitted only by internal callers
   * (`closeAll`), which are not answering a frame.
   */
  private assertScope(hold: RunHold, profileId?: string): void {
    if (profileId === undefined) return;
    if (hold.profileKey === sanitizeProfileId(profileId)) return;
    throw new ProfileError('esta sessão de navegador pertence a outro perfil');
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
        // REFUSED AFTER RELEASE, and this is not defensive decoration. A step can still be in
        // flight when the run's explicit release lands - Cortex sends the release from a run
        // `finally` while an invoke it gave up waiting for is still executing here. That step then
        // asks for a page, finds `runPage` nulled by the release, and opens a BRAND NEW ONE that
        // nothing will ever close: an orphan window on the user's desktop, holding the profile
        // context open, outside every lifecycle this file defines.
        if (released) throw new ProfileError('a sessão de navegador desta execução já foi encerrada');
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
        // Set BEFORE anything is torn down, so a step still in flight cannot open a page behind the
        // teardown (see `page()` above).
        released = true;
        const page = runPage;
        runPage = null;
        try {
          // THE ORDER IS THREE STEPS AND EACH ONE HAS TO BE WHERE IT IS.
          //  1. localStorage FIRST, because removing a seeded key needs a LIVE page: on a
          //     persistent profile localStorage is on disk, so closing the page does not clear it.
          //  2. Then close the page, so nothing can be handed a `Set-Cookie` by a request still in
          //     flight AFTER the jar is wiped - a cookie written after the wipe survives it.
          //  3. Then the jar. Last, and in a `finally`, so it happens even if either step above
          //     throws: an unremoved localStorage key is untidy, an unwiped cookie jar is a live
          //     session in a profile the next automation shares.
          await this.clearSeededStorage(context, session ?? null, seeded);
          if (page && !page.isClosed()) await page.close().catch(() => undefined);
        } finally {
          try {
            // NOT swallowed. `releaseRun` propagates this to the executor, which answers the wire
            // with a failed step - a run must never be told it ended cleanly while its session is
            // still resident in a jar the next run shares.
            await context.clearCookies();
          } finally {
            // The profile mutex is given back whatever happened: a failed wipe must not also
            // deadlock every later run on this profile.
            this.armIdleClose(key);
            releaseHold();
          }
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
    // Release live leases FIRST. Closing the context underneath a lease would drop the jar without
    // clearing it, which on a persistent profile means the injected session survives on DISK.
    // A wipe that fails here has nowhere to be answered - the daemon is going away - so it is SAID
    // OUT LOUD to the operator instead of swallowed, and shutdown continues.
    for (const leaseId of [...this.runs.keys()]) {
      await this.releaseRun(leaseId).catch((err: unknown) => {
        this.deps.log?.(`Aviso: não foi possível limpar a sessão de navegador de uma execução (${errorText(err)}).`);
      });
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
   * The lease's hold, taken on the first step that names it. A lease that is already held is handed
   * back untouched - same page, same cookies - which is the whole point of the run scope, and is
   * also what makes a sub-automation's steps land on its parent's page instead of deadlocking
   * behind the parent's hold.
   */
  private async holdForRun(input: {
    leaseId: string;
    profileId: string;
    session?: () => ProfileSession | null;
  }): Promise<RunHold> {
    if (this.closed) throw new ProfileError('o gestor de perfis já foi encerrado');
    const key = sanitizeProfileId(input.profileId);

    const existing = this.runs.get(input.leaseId);
    if (existing) {
      // A lease belongs to ONE profile. A step naming it under another owner is refused rather than
      // quietly migrating the lease - see `assertScope`.
      this.assertScope(existing, input.profileId);
      return existing;
    }

    const ended = this.endedRuns.get(input.leaseId);
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
    this.runs.set(input.leaseId, hold);
    // A failed acquire must not leave a poisoned hold behind: the next step should be free to try
    // again (a launch can fail transiently), and awaiting a rejected promise twice is not a retry.
    lease.catch(() => {
      if (this.runs.get(input.leaseId) === hold) this.runs.delete(input.leaseId);
    });
    await lease;
    return hold;
  }

  /**
   * The idle backstop. Reaps a lease that has sat with nothing arriving for it - no step, no
   * keepalive - for `runIdleMs`, which is the case where Cortex died and the explicit release will
   * never come. A BUSY lease is never reaped; the timer simply re-arms, because the window bounds
   * silence, not the length of a step.
   */
  private armRunIdle(leaseId: string, hold: RunHold): void {
    // The lease may have been released while this step was running (`withRunLease` arms from its
    // `finally`). Arming a timer on a hold nobody owns leaves a timer with nothing to reap.
    if (this.runs.get(leaseId) !== hold) return;
    const idleMs = this.deps.runIdleMs ?? RUN_IDLE_MS;
    if (hold.idleTimer) {
      clearTimeout(hold.idleTimer);
      delete hold.idleTimer;
    }
    if (idleMs <= 0) return;
    const timer = setTimeout(() => {
      if (this.runs.get(leaseId) !== hold) return; // already released explicitly
      if (hold.busy > 0) {
        this.armRunIdle(leaseId, hold);
        return;
      }
      this.deps.log?.('A sessão de navegador de uma execução expirou por inactividade e foi encerrada.');
      void this.releaseRun(leaseId, { reason: 'idle' }).catch((err: unknown) => {
        // The reap has no caller to answer, so the failure would otherwise be silent - and a reap
        // whose WIPE failed is the case where an authenticated jar is still resident.
        this.deps.log?.(`Aviso: não foi possível limpar a sessão de navegador expirada (${errorText(err)}).`);
      });
    }, idleMs);
    timer.unref?.();
    hold.idleTimer = timer;
  }

  /** Remember that a lease ended, bounded. Insertion order is the eviction order. */
  private markRunEnded(leaseId: string, reason: LeaseEnd): void {
    this.endedRuns.delete(leaseId);
    this.endedRuns.set(leaseId, reason);
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
   * for a destructive function, and it is genuinely UNREACHABLE through the public API. It stays
   * because the next call site added to this function should not have to rediscover the invariant -
   * and because a guard nothing can fail is indistinguishable from a guard that does not work, it
   * is pinned by a test that calls THIS METHOD directly ("the guard on the destructive function
   * itself", run-lease.test.ts) rather than left to be believed. The cross-process case is bounded
   * elsewhere: `serve.ts` refuses a second daemon on the same home via the pidfile.
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
   * Half of undoing the run's session: the seeded localStorage keys, removed from whatever pages
   * are still open on those origins. It needs a LIVE page - on a persistent profile localStorage
   * lives on disk, so a closed page keeps its keys - which is why the caller does this before it
   * closes anything.
   *
   * BEST EFFORT, unlike the cookie wipe the caller does afterwards. These are per-page removals of
   * keys this run itself seeded, on pages that may legitimately have navigated away or closed
   * mid-teardown; the jar wipe is the one that must be loud if it fails.
   */
  private async clearSeededStorage(
    context: ProfileContext,
    session: ProfileSession | null,
    seeded: Set<string>,
  ): Promise<void> {
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

/** A thrown value as one line of operator-facing text. Never the value itself - a rejection from
 *  Playwright can quote a cookie. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
