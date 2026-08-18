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
 */
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs';
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
 *  visible browser window open forever. */
const IDLE_CLOSE_MS = 10 * 60_000;

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
  /** Idle-close window; 0 disables the timer (tests). */
  idleCloseMs?: number;
}

interface HeldProfile {
  context: ProfileContext;
  userDataDir: string;
  /** The tail of the per-profile mutex chain. A new acquire awaits it and installs its own. */
  tail: Promise<void>;
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
  private closed = false;

  constructor(private readonly deps: ProfileManagerDeps) {}

  /** `<home>/profiles/<profileId>`, created 0700. Exposed so tests can assert WHERE it lands. */
  userDataDirFor(profileId: string): string {
    return join(this.deps.home, 'profiles', sanitizeProfileId(profileId));
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

  /** Close every open profile context (daemon shutdown). */
  async closeAll(): Promise<void> {
    this.closed = true;
    const contexts = [...this.held.values()];
    this.held.clear();
    for (const h of contexts) {
      if (h.idleTimer) clearTimeout(h.idleTimer);
      await h.context.close().catch(() => undefined);
    }
  }

  /** Open profileIds, for the status surface and tests. */
  openProfiles(): string[] {
    return [...this.held.keys()];
  }

  // --- internals ------------------------------------------------------------

  private async ensureContext(key: string): Promise<ProfileContext> {
    const existing = this.held.get(key);
    if (existing) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        delete existing.idleTimer;
      }
      return existing.context;
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
    this.clearStaleSingletonLock(userDataDir);

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
    this.held.set(key, { context, userDataDir, tail: Promise.resolve() });
    return context;
  }

  /**
   * A crash leaves Chromium's singleton markers behind and every later launch fails on them. They
   * are only ever cleared when THIS process holds no live context for the profile - otherwise we
   * would be deleting the lock of a browser that is genuinely running.
   */
  private clearStaleSingletonLock(userDataDir: string): void {
    for (const marker of SINGLETON_MARKERS) {
      const p = join(userDataDir, marker);
      if (!existsSync(p)) continue;
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

  private armIdleClose(key: string): void {
    const idleMs = this.deps.idleCloseMs ?? IDLE_CLOSE_MS;
    if (idleMs <= 0) return;
    const held = this.held.get(key);
    if (!held) return;
    if (held.idleTimer) clearTimeout(held.idleTimer);
    const timer = setTimeout(() => {
      const current = this.held.get(key);
      if (!current) return;
      this.held.delete(key);
      void current.context.close().catch(() => undefined);
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
