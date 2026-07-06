/**
 * Shared headless-Chromium pool (spec/07-app-pipeline.md §7.11; carryover
 * services sweep, `browser-pool` row).
 *
 * Services that must SEE a rendered page - artifact screenshots, and later
 * brand-research colour sampling - share ONE Playwright Chromium process rather
 * than each launching their own. Lazy-launched on first use, a concurrent-launch
 * guard keeps two simultaneous requests from spawning two browsers, and a
 * process-exit hook cleans it up on shutdown.
 *
 * Playwright is imported dynamically so a machine that has not yet downloaded the
 * Chromium binary can still load this module (the binary is only needed at launch).
 */

let browserInstance: import('playwright').Browser | null = null;
let browserLaunchPromise: Promise<import('playwright').Browser> | null = null;
let cleanupRegistered = false;

/** Get the shared Chromium, launching it (once) on first use. */
export async function getSharedBrowser(): Promise<import('playwright').Browser> {
  if (browserInstance?.isConnected()) {
    return browserInstance;
  }

  // Concurrent-launch guard: a second caller during launch reuses the in-flight promise.
  if (browserLaunchPromise) {
    return browserLaunchPromise;
  }

  browserLaunchPromise = (async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    browserInstance = browser;

    if (!cleanupRegistered) {
      cleanupRegistered = true;
      const cleanup = (): void => {
        if (browserInstance?.isConnected()) {
          browserInstance.close().catch(() => {});
          browserInstance = null;
        }
      };
      process.on('exit', cleanup);
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    }

    return browser;
  })();

  try {
    return await browserLaunchPromise;
  } finally {
    browserLaunchPromise = null;
  }
}

/** Close the shared browser if open. Exposed for tests and orderly shutdown. */
export async function closeSharedBrowser(): Promise<void> {
  const b = browserInstance;
  browserInstance = null;
  if (b?.isConnected()) await b.close().catch(() => {});
}
