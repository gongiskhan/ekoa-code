/**
 * browser/chrome-launch.ts — open a HEADED, persistent, real-Chrome window the same way the
 * execution plane does, for the one other place that needs it: the attended ceremony.
 *
 * WHY THIS EXISTS. `ProfileManager` (`profile.ts`) launches persistent real Chrome for RUN leases —
 * with session injection, a per-profile mutex, an idle reaper and a wipe-on-release. The attended
 * ceremony needs the SAME window (real Chrome, a dedicated non-default `--user-data-dir`, the same
 * anti-automation hygiene) but NONE of the lease machinery: it opens one window, a human logs into
 * it at their own pace, and the resulting `storageState` is captured. Forcing the ceremony through a
 * run lease would give it session injection it must not do and a wipe-on-release and idle reap that
 * would close the window under a human who stepped away to fetch a one-time code. So the LAUNCH
 * primitive is shared here and the two lifecycles stay separate.
 *
 * WHY A DEDICATED PROFILE AND NOT THE USER'S OWN CHROME. Chrome 136 (May 2025) made
 * `--remote-debugging-port`/`--remote-debugging-pipe` no-ops on the DEFAULT user-data-dir, precisely
 * to stop a process attaching to the everyday profile and lifting its cookies — the infostealer
 * pattern. A dedicated `--user-data-dir` (which is what this and `ProfileManager` both use) gets its
 * own encryption key and is the only supported way to drive real Chrome. The cost is one login per
 * site; the win is a NORMAL Chrome window, no extension, and a profile whose logins persist.
 *
 * REALNESS IS HYGIENE, NOT A STEALTH STACK. `channel: 'chrome'` for the real user-agent/TLS/client
 * hints, bundled chromium as the honest fallback, `--disable-blink-features=AutomationControlled`
 * and the one init script that removes the tell Playwright itself adds. The ceremony ADDS to this:
 * `ignoreDefaultArgs: ['--enable-automation']` drops the "controlled by automated software" infobar,
 * so the human types their real password into a window that looks like their own browser, not a
 * robot's.
 */
import { mkdirSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_VIEWPORT,
  SINGLETON_MARKERS,
  WEBDRIVER_INIT_SCRIPT,
  hostLocale,
  isMissingBrowserBinary,
  BrowserUnavailableError,
  BROWSER_INSTALL_COMMAND,
  ProfileError,
} from './profile.js';

/** How long OPENING the window may take across both attempts (real Chrome, then bundled). Matches
 *  `ProfileManager`'s budget: Chrome-then-bundled must still answer inside Cortex's ceremony TTL. */
const LAUNCH_TIMEOUT_MS = 60_000;
const MIN_FALLBACK_LAUNCH_MS = 5_000;

/**
 * The minimal Chrome DevTools Protocol session the attended-ceremony LIVE STREAM drives
 * (D-CEREMONY-STREAM). Exactly two members: `send` (for `Page.startScreencast`,
 * `Page.screencastFrameAck` and `Input.dispatch*`) and `on` (for `Page.screencastFrame`). A real
 * Playwright `CDPSession` satisfies this structurally, so the launcher casts at the seam the same way
 * it casts the context itself; keeping it to two members means a fake in a unit test is a handful of
 * lines and pulls in no Playwright.
 */
export interface BridgeCdpSession {
  send(method: string, params?: unknown): Promise<unknown>;
  // A CDP event payload is untyped at this seam; the one handler (`Page.screencastFrame`) narrows it.
  on(event: string, handler: (payload: any) => void): void;
}

/** The slice of a Playwright persistent context the ceremony uses. Real `BrowserContext`/`Page`
 *  satisfy these structurally; the launcher casts at the seam, exactly as the run executor does. */
export interface HeadedChromePage {
  goto(url: string, opts?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' }): Promise<unknown>;
  url(): string;
  on(event: 'close' | 'framenavigated', handler: () => void): void;
}
export interface HeadedChromeContext {
  pages(): HeadedChromePage[];
  newPage(): Promise<HeadedChromePage>;
  addInitScript(script: string): Promise<void>;
  storageState(): Promise<unknown>;
  close(): Promise<void>;
  on(event: 'close', handler: () => void): void;
  /**
   * Obtain a minimal CDP session for the live page, or absent when this context cannot produce one.
   * OPTIONAL and additive: the real launch attaches it below (a cast over Playwright's
   * `context.newCDPSession(page)`), while an injected/fake launcher that never sets it simply never
   * streams — the ceremony holds its window exactly as before, local-only.
   */
  newCDPSession?(): Promise<BridgeCdpSession>;
}

/**
 * Keep the whole ceremony inside the ONE tab the live stream follows (D-CEREMONY-STREAM-COORDS,
 * 2026-08-27). A login page's "Log in"/nav links routinely open a NEW tab or a popup
 * (`target="_blank"`, `window.open`), and the stream follows only the ceremony's own tab - so a login
 * that jumped to a new tab was invisible and uncontrollable in the dashboard, the human clicked again
 * thinking it failed, and every new tab RAISED the headed window on macOS: a few stray clicks spiralled
 * into the window stealing focus over and over ("it takes over the computer"). This forces those opens
 * back into the current tab: `window.open` navigates in place, and a capture-phase click strips
 * `target="_blank"` before the browser acts on it. A full-page login (email/password/2FA - what these
 * portals use) is unchanged. The one flow it does NOT serve is an OAuth login that genuinely needs a
 * separate popup window posting back to its opener; that is a documented limitation, not the common
 * case, and the ceremony card already steers Google-SSO users to email/phone.
 */
export const SAME_TAB_INIT_SCRIPT = `(() => {
  try {
    window.open = function (url) {
      if (url != null) { try { window.location.href = String(url); } catch (e) {} }
      return null;
    };
  } catch (e) {}
  try {
    document.addEventListener('click', function (e) {
      try {
        var t = e.target;
        var a = t && t.closest ? t.closest('a[target="_blank"]') : null;
        if (a) a.removeAttribute('target');
      } catch (err) {}
    }, true);
  } catch (e) {}
})();`;

/** The injected launcher, so the unit lane drives the ceremony without a real browser. */
export type PersistentContextLauncher = (
  userDataDir: string,
  opts: Record<string, unknown>,
) => Promise<HeadedChromeContext>;

export interface LaunchHeadedChromeDeps {
  /** Defaults to Playwright's `chromium.launchPersistentContext`, imported lazily. */
  launch?: PersistentContextLauncher;
  /** User-visible progress, in Portuguese — this runs where the human is sitting. */
  log?: (message: string) => void;
}

/**
 * A crash leaves Chromium's singleton markers behind and every later launch fails on them. `lstat`
 * NOT `existsSync`: real Chrome writes `SingletonLock` as a SYMLINK to `<host>-<pid>`, a target that
 * never exists on disk, so `existsSync` follows the dangling link and reports false. This is the
 * free-function half of `ProfileManager.clearStaleSingletonLock` — the ceremony holds no `held` map,
 * so it has no live-lock to guard (it opens one window at a time behind `ceremonyInFlight`).
 */
export function sweepSingletonMarkers(userDataDir: string): void {
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
      /* not ours to remove; the launch below reports the real failure */
    }
  }
}

/**
 * Open a headed, persistent real-Chrome window at `userDataDir`. Real installed Chrome first (real
 * UA/TLS/client hints), bundled chromium as the honest fallback, and a machine with neither told so
 * by name with the one command that fixes it. The infobar is suppressed so the window reads as an
 * ordinary browser to the human who has to log into it.
 */
export async function launchHeadedRealChrome(
  userDataDir: string,
  deps: LaunchHeadedChromeDeps = {},
): Promise<HeadedChromeContext> {
  mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
  sweepSingletonMarkers(userDataDir);

  const launch = deps.launch ?? defaultPersistentLaunch;
  const base: Record<string, unknown> = {
    headless: false,
    viewport: { ...DEFAULT_VIEWPORT },
    ...hostLocale(),
    args: ['--disable-blink-features=AutomationControlled'],
    // Drop the "Chrome is being controlled by automated test software" infobar. A human is about to
    // type a real password here; the banner is both alarming and a stronger automation tell than the
    // one `WEBDRIVER_INIT_SCRIPT` removes.
    ignoreDefaultArgs: ['--enable-automation'],
    timeout: LAUNCH_TIMEOUT_MS,
  };

  const startedAt = Date.now();
  let context: HeadedChromeContext;
  try {
    context = await launch(userDataDir, { ...base, channel: 'chrome' });
  } catch (err) {
    deps.log?.('Chrome não encontrado; a usar o navegador incluído.');
    const remaining = LAUNCH_TIMEOUT_MS - (Date.now() - startedAt);
    try {
      context = await launch(userDataDir, { ...base, timeout: Math.max(MIN_FALLBACK_LAUNCH_MS, remaining) });
    } catch (second) {
      if (isMissingBrowserBinary(second)) {
        throw new BrowserUnavailableError(
          `não há nenhum navegador instalado nesta máquina - execute \`${BROWSER_INSTALL_COMMAND}\` e volte a tentar`,
        );
      }
      throw new ProfileError(
        `não foi possível abrir o navegador: ${second instanceof Error ? second.message : String(second)} (primeira tentativa: ${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  await context.addInitScript(WEBDRIVER_INIT_SCRIPT).catch(() => undefined);
  // Keep the ceremony in the one streamed tab: new-tab/popup opens navigate in place instead of
  // raising a second window the stream cannot follow (and macOS cannot stop raising to the front).
  await context.addInitScript(SAME_TAB_INIT_SCRIPT).catch(() => undefined);
  attachCdpSeam(context);
  return context;
}

/**
 * Give the returned context the no-arg `newCDPSession()` the live-stream seam expects, wrapping
 * Playwright's page-taking `context.newCDPSession(page)` so it targets the window's live tab
 * (`pages()[0]`, the same tab the ceremony drives). The real method is captured BEFORE the own
 * property shadows it, so the wrapper delegates to the genuine one; a launcher whose context has no
 * `newCDPSession` (the unit-test fakes) is left untouched and its ceremony simply never streams.
 */
function attachCdpSeam(context: HeadedChromeContext): void {
  const pw = context as unknown as {
    newCDPSession?: (page: unknown) => Promise<BridgeCdpSession>;
    pages(): unknown[];
    newPage(): Promise<unknown>;
  };
  if (typeof pw.newCDPSession !== 'function') return;
  const realNewCdp = pw.newCDPSession.bind(pw);
  (context as { newCDPSession?: () => Promise<BridgeCdpSession> }).newCDPSession = async (): Promise<BridgeCdpSession> => {
    const page = pw.pages()[0] ?? (await pw.newPage());
    return realNewCdp(page);
  };
}

/** Playwright's persistent context, HEADED. Imported dynamically so the module graph does not pull
 *  Playwright into a daemon that never opens a browser. */
const defaultPersistentLaunch: PersistentContextLauncher = async (userDataDir, opts) => {
  const { chromium } = await import('playwright');
  return (await chromium.launchPersistentContext(userDataDir, opts as never)) as unknown as HeadedChromeContext;
};
