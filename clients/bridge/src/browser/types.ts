/**
 * browser/types.ts - the slice of Playwright the execution plane uses, named as interfaces so
 * every unit test can substitute a fake and NO test needs a real browser.
 *
 * This is the same discipline `attended/ceremony.ts` already applies (`CeremonyBrowser`/
 * `CeremonyContext`/`CeremonyPage` + an injected `launchBrowser`), and it is not decoration: the
 * execution plane launches HEADED Chrome, and a headed launch cannot run on a CI runner with no
 * display. Typing against a structural interface rather than Playwright's own types means the unit
 * lane exercises the real dispatch logic against a fake page, and the only thing that needs a real
 * display is the live-verification pass, which says so out loud instead of pretending.
 *
 * Playwright's real `Page`/`BrowserContext`/`Locator` satisfy these structurally; the default
 * launcher casts at the seam, exactly as the ceremony does.
 */

export interface ProfileLocator {
  first(): ProfileLocator;
  click(opts?: { timeout?: number }): Promise<void>;
  dblclick(opts?: { timeout?: number }): Promise<void>;
  fill(value: string, opts?: { timeout?: number }): Promise<void>;
  pressSequentially(value: string, opts?: { delay?: number; timeout?: number }): Promise<void>;
  press(key: string, opts?: { timeout?: number }): Promise<void>;
  selectOption(value: string, opts?: { timeout?: number }): Promise<unknown>;
  check(opts?: { timeout?: number }): Promise<void>;
  uncheck(opts?: { timeout?: number }): Promise<void>;
  hover(opts?: { timeout?: number }): Promise<void>;
  waitFor(opts?: { state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout?: number }): Promise<void>;
  scrollIntoViewIfNeeded(opts?: { timeout?: number }): Promise<void>;
  isVisible(opts?: { timeout?: number }): Promise<boolean>;
  innerText(opts?: { timeout?: number }): Promise<string>;
}

export interface ProfilePage {
  goto(url: string, opts?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  /** PNG bytes. The executor base64s them onto `tool.result.screenshotB64`. */
  screenshot(opts?: { type?: 'png'; fullPage?: boolean; timeout?: number }): Promise<Buffer>;
  /** String form only - the daemon compiles with `lib: ES2022` and has no DOM types. */
  evaluate(script: string): Promise<unknown>;
  viewportSize(): { width: number; height: number } | null;
  waitForTimeout(ms: number): Promise<void>;
  waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle'): Promise<void>;
  keyboard: { press(key: string): Promise<void> };
  mouse: { wheel(deltaX: number, deltaY: number): Promise<void> };
  getByRole(role: string, opts?: { name?: string; exact?: boolean }): ProfileLocator;
  getByText(value: string, opts?: { exact?: boolean }): ProfileLocator;
  getByLabel(value: string, opts?: { exact?: boolean }): ProfileLocator;
  getByPlaceholder(value: string): ProfileLocator;
  getByTestId(value: string): ProfileLocator;
  getByAltText(value: string): ProfileLocator;
  getByTitle(value: string): ProfileLocator;
  locator(selector: string): ProfileLocator;
  isClosed(): boolean;
  close(): Promise<void>;
}

/** A cookie as `BrowserContext.addCookies` accepts it. Guarded field-by-field before use: the
 *  payload crosses the credential boundary as opaque data from the Cofre. */
export interface ProfileCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  url?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface ProfileContext {
  newPage(): Promise<ProfilePage>;
  pages(): ProfilePage[];
  addCookies(cookies: ProfileCookie[]): Promise<void>;
  clearCookies(): Promise<void>;
  addInitScript(script: string): Promise<void>;
  close(): Promise<void>;
}

/** Options handed to `chromium.launchPersistentContext`. Kept as a plain record so the fake
 *  launcher in the unit lane can assert on exactly what the real one would receive. */
export interface PersistentLaunchOptions {
  channel?: string;
  headless: boolean;
  viewport: { width: number; height: number };
  locale?: string;
  timezoneId?: string;
  args: string[];
  timeout?: number;
}

/** The injected launcher. Default (profile.ts) is Playwright's `chromium.launchPersistentContext`. */
export type PersistentLauncher = (
  userDataDir: string,
  opts: PersistentLaunchOptions,
) => Promise<ProfileContext>;
